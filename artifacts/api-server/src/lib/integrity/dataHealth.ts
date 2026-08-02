/**
 * DH-1 .. DH-8 — structural integrity of the budget-line entity model.
 * See audit/integrity-checks-spec.md.
 */
import { eq, sql } from "drizzle-orm";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  forecastPlansTable,
  eventsTable,
  alertsTable,
  csvImportRowsTable,
} from "@workspace/db";
import {
  type AffectedEntity,
  type CheckFinding,
  type CheckResult,
  MAX_AFFECTED_PER_FINDING,
  isBlank,
  normaliseLoose,
  normaliseStrict,
} from "./types";

/** Recognised cost statuses; anything else (including blank) is flagged by DH-7. */
const VALID_COST_STATUSES = new Set(["Fixed Cost", "Variable", "Planned", "Booked", "Spent"]);

/** Words dropped before similarity comparison in DH-3. */
const QUALIFIER_WORDS = new Set(["the", "a", "an", "and", "of", "for", "to", "in", "at", "on"]);

type Line = typeof budgetLinesTable.$inferSelect;

interface LineTotals {
  plan: number;
  actual: number;
}

function lineLabel(line: Line): string {
  return `${line.category ?? "(no category)"} | ${line.lineItem ?? "(no line item)"}`;
}

function truncate<T>(items: T[]): { shown: T[]; total: number } {
  return { shown: items.slice(0, MAX_AFFECTED_PER_FINDING), total: items.length };
}

/** Loads the per-line plan/actual totals every data-health check reasons about. */
async function loadTotals(year: number): Promise<Map<number, LineTotals>> {
  const [plans, actuals] = await Promise.all([
    db
      .select({
        budgetLineId: monthlyPlansTable.budgetLineId,
        total: sql<string>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
      })
      .from(monthlyPlansTable)
      .where(eq(monthlyPlansTable.year, year))
      .groupBy(monthlyPlansTable.budgetLineId),
    db
      .select({
        budgetLineId: monthlyActualsTable.budgetLineId,
        total: sql<string>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
      })
      .from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.year, year))
      .groupBy(monthlyActualsTable.budgetLineId),
  ]);

  const totals = new Map<number, LineTotals>();
  for (const p of plans) {
    totals.set(p.budgetLineId, { plan: Number(p.total), actual: 0 });
  }
  for (const a of actuals) {
    const existing = totals.get(a.budgetLineId);
    if (existing) existing.actual = Number(a.total);
    else totals.set(a.budgetLineId, { plan: 0, actual: Number(a.total) });
  }
  return totals;
}

function totalsFor(totals: Map<number, LineTotals>, id: number): LineTotals {
  return totals.get(id) ?? { plan: 0, actual: 0 };
}

// ─── DH-1 — duplicate budget lines ───────────────────────────────────────────

function checkDuplicateLines(lines: Line[], totals: Map<number, LineTotals>): CheckFinding[] {
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    const key = `${normaliseStrict(line.category)}||${normaliseStrict(line.lineItem)}`;
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  const findings: CheckFinding[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.id - b.id);
    const keeper = sorted[0];
    const affected: AffectedEntity[] = sorted.map((line) => {
      const t = totalsFor(totals, line.id);
      return {
        entityType: "budget_line",
        entityId: line.id,
        label: lineLabel(line),
        detail: {
          role: line.id === keeper.id ? "keep (oldest)" : "merge into keeper",
          plan: t.plan,
          spent: t.actual,
          owner: line.owner ?? "",
        },
      };
    });
    const { shown, total } = truncate(affected);
    findings.push({
      id: "DH-1",
      category: "data-health",
      title: "Duplicate budget lines",
      severity: "critical",
      description:
        `${members.length} budget lines share the same category and line item ` +
        `("${lineLabel(keeper)}"). Their budget and spend are split across separate rows, ` +
        `so the remaining figure is wrong on each of them.`,
      remediation:
        `Merge onto the oldest row (#${keeper.id}), moving each month's figures across. ` +
        `Where both rows hold a different non-zero amount for the same month, that month ` +
        `needs a human decision before merging.`,
      affected: shown,
      affectedCount: total,
    });
  }
  return findings;
}

// ─── DH-2 — near-duplicate budget lines ──────────────────────────────────────

function checkNearDuplicateLines(lines: Line[], totals: Map<number, LineTotals>): CheckFinding[] {
  const looseGroups = new Map<string, Line[]>();
  for (const line of lines) {
    const key = `${normaliseLoose(line.category)}||${normaliseLoose(line.lineItem)}`;
    const list = looseGroups.get(key) ?? [];
    list.push(line);
    looseGroups.set(key, list);
  }

  const findings: CheckFinding[] = [];
  for (const members of looseGroups.values()) {
    if (members.length < 2) continue;
    // Already reported by DH-1 if they also match under the strict key.
    const strictKeys = new Set(
      members.map((l) => `${normaliseStrict(l.category)}||${normaliseStrict(l.lineItem)}`),
    );
    if (strictKeys.size < 2) continue;

    const sorted = [...members].sort((a, b) => a.id - b.id);
    const affected: AffectedEntity[] = sorted.map((line) => {
      const t = totalsFor(totals, line.id);
      return {
        entityType: "budget_line",
        entityId: line.id,
        label: lineLabel(line),
        detail: { plan: t.plan, spent: t.actual, owner: line.owner ?? "" },
      };
    });
    const { shown, total } = truncate(affected);
    findings.push({
      id: "DH-2",
      category: "data-health",
      title: "Near-duplicate budget lines",
      severity: "warning",
      description:
        `${members.length} budget lines differ only by punctuation, spacing or capitalisation ` +
        `(${sorted.map((l) => `"${l.lineItem}"`).join(" vs ")}). They may be the same line ` +
        `recorded twice.`,
      remediation:
        "These are not merged automatically, because dropping punctuation can group genuinely " +
        "different lines together. If they are the same line, rename one to match the other " +
        "exactly and re-run this check — it will then merge as a normal duplicate.",
      affected: shown,
      affectedCount: total,
    });
  }
  return findings;
}

// ─── DH-3 — split plan/actual pairs ──────────────────────────────────────────

function similarityKey(value: string | null): string {
  return normaliseLoose(
    (value ?? "")
      .split(/\s+/)
      .filter((w) => !QUALIFIER_WORDS.has(w.toLowerCase()))
      .join(" "),
  );
}

function checkSplitPairs(lines: Line[], totals: Map<number, LineTotals>): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const byCategory = new Map<string, Line[]>();
  for (const line of lines) {
    const key = normaliseStrict(line.category);
    const list = byCategory.get(key) ?? [];
    list.push(line);
    byCategory.set(key, list);
  }

  for (const members of byCategory.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        if (similarityKey(a.lineItem) !== similarityKey(b.lineItem)) continue;
        // Already reported by DH-1 as an outright duplicate; repeating it here
        // as a second finding is noise, not extra information.
        if (normaliseStrict(a.lineItem) === normaliseStrict(b.lineItem)) continue;

        const ta = totalsFor(totals, a.id);
        const tb = totalsFor(totals, b.id);
        const aPlanOnly = ta.plan !== 0 && ta.actual === 0;
        const bActualOnly = tb.plan === 0 && tb.actual !== 0;
        const bPlanOnly = tb.plan !== 0 && tb.actual === 0;
        const aActualOnly = ta.plan === 0 && ta.actual !== 0;
        if (!((aPlanOnly && bActualOnly) || (bPlanOnly && aActualOnly))) continue;

        findings.push({
          id: "DH-3",
          category: "data-health",
          title: "Budget and spend split across two lines",
          severity: "warning",
          description:
            `"${a.lineItem}" and "${b.lineItem}" look like the same line: one carries the ` +
            `budget with no spend, the other carries spend with no budget. Neither shows a ` +
            `meaningful remaining figure while they stay separate.`,
          remediation:
            "Confirm whether these are the same line. If so, rename one to match the other " +
            "exactly and re-run this check to merge them.",
          affected: [a, b].map((line) => {
            const t = totalsFor(totals, line.id);
            return {
              entityType: "budget_line",
              entityId: line.id,
              label: lineLabel(line),
              detail: { plan: t.plan, spent: t.actual },
            };
          }),
          affectedCount: 2,
        });
      }
    }
  }
  return findings;
}

// ─── DH-4 — inconsistent blank representation ────────────────────────────────

const NULLABLE_TEXT_FIELDS = ["owner", "region", "costStatus", "channel", "subcategory"] as const;

function checkBlankRepresentation(lines: Line[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const field of NULLABLE_TEXT_FIELDS) {
    let nulls = 0;
    let empties = 0;
    const affected: AffectedEntity[] = [];
    for (const line of lines) {
      const value = line[field];
      if (value === null || value === undefined) nulls++;
      else if (typeof value === "string" && value.trim() === "") {
        empties++;
        affected.push({
          entityType: "budget_line",
          entityId: line.id,
          label: lineLabel(line),
          detail: { field, storedAs: "empty string" },
        });
      }
    }
    if (nulls > 0 && empties > 0) {
      const { shown, total } = truncate(affected);
      findings.push({
        id: "DH-4",
        category: "data-health",
        title: "Inconsistent empty values",
        severity: "warning",
        description:
          `"${field}" is stored both as empty and as not-set across different budget lines ` +
          `(${nulls} not-set, ${empties} empty). The two look identical on screen but do not ` +
          `match each other when lines are compared, which can hide duplicates.`,
        remediation: `Normalise the ${empties} empty "${field}" values to not-set.`,
        affected: shown,
        affectedCount: total,
      });
    }
  }
  return findings;
}

// ─── DH-5 — orphaned child rows ──────────────────────────────────────────────

async function checkOrphanedRows(): Promise<CheckFinding[]> {
  const targets = [
    { table: monthlyPlansTable, name: "monthly_plans", label: "monthly plan", cascade: true },
    { table: monthlyActualsTable, name: "monthly_actuals", label: "monthly actual", cascade: true },
    { table: forecastPlansTable, name: "forecast_plans", label: "forecast plan", cascade: true },
    { table: eventsTable, name: "events", label: "event", cascade: false },
    { table: alertsTable, name: "alerts", label: "alert", cascade: false },
    { table: csvImportRowsTable, name: "csv_import_rows", label: "import row", cascade: false },
  ] as const;

  const findings: CheckFinding[] = [];
  for (const target of targets) {
    const [row] = await db
      .select({ count: sql<string>`count(*)` })
      .from(target.table)
      .leftJoin(budgetLinesTable, eq(budgetLinesTable.id, target.table.budgetLineId))
      .where(sql`${target.table.budgetLineId} IS NOT NULL AND ${budgetLinesTable.id} IS NULL`);

    const count = Number(row?.count ?? 0);
    if (count === 0) continue;

    findings.push({
      id: "DH-5",
      category: "data-health",
      title: "Rows pointing at a budget line that no longer exists",
      severity: "critical",
      description: `${count} ${target.label} row(s) reference a deleted budget line.`,
      remediation: target.cascade
        ? "These should not be able to exist — the database is set up to remove them with " +
          "their budget line. Needs investigation before anything is changed."
        : "Clear the stale link on these rows.",
      affected: [{ entityType: target.name, label: `${count} orphaned ${target.label} row(s)` }],
      affectedCount: count,
    });
  }
  return findings;
}

// ─── DH-6 — category name drift ──────────────────────────────────────────────

function checkCategoryDrift(lines: Line[]): CheckFinding[] {
  const byLoose = new Map<string, Map<string, number>>();
  for (const line of lines) {
    const loose = normaliseLoose(line.category);
    if (!loose) continue;
    const spellings = byLoose.get(loose) ?? new Map<string, number>();
    const raw = line.category ?? "";
    spellings.set(raw, (spellings.get(raw) ?? 0) + 1);
    byLoose.set(loose, spellings);
  }

  const findings: CheckFinding[] = [];
  for (const spellings of byLoose.values()) {
    if (spellings.size < 2) continue;
    const variants = [...spellings.entries()].sort((a, b) => b[1] - a[1]);
    findings.push({
      id: "DH-6",
      category: "data-health",
      title: "Same category spelled more than one way",
      severity: "warning",
      description:
        `These spellings all refer to the same category: ${variants
          .map(([name, n]) => `"${name}" (${n} line${n === 1 ? "" : "s"})`)
          .join(", ")}. Any report grouped by category splits them into separate buckets.`,
      remediation: `Rename all of them to one spelling — "${variants[0][0]}" is the most used.`,
      affected: variants.map(([name, n]) => ({
        entityType: "category",
        label: name,
        detail: { lines: n },
      })),
      affectedCount: variants.length,
    });
  }
  return findings;
}

// ─── DH-7 — non-standard cost status ─────────────────────────────────────────

function checkCostStatus(lines: Line[]): CheckFinding[] {
  const affected: AffectedEntity[] = [];
  for (const line of lines) {
    const value = line.costStatus;
    if (isBlank(value) || !VALID_COST_STATUSES.has(value as string)) {
      affected.push({
        entityType: "budget_line",
        entityId: line.id,
        label: lineLabel(line),
        detail: { costStatus: isBlank(value) ? "(blank)" : String(value) },
      });
    }
  }
  if (affected.length === 0) return [];

  const { shown, total } = truncate(affected);
  return [
    {
      id: "DH-7",
      category: "data-health",
      title: "Unrecognised cost status",
      severity: "critical",
      description:
        `${total} budget line(s) have a cost status that is blank or outside the recognised ` +
        `set (${[...VALID_COST_STATUSES].join(", ")}). Blank values fail the app's own ` +
        `spreadsheet validation, so an export of this data cannot be re-imported.`,
      remediation: "Set a valid cost status on each of these lines.",
      affected: shown,
      affectedCount: total,
    },
  ];
}

// ─── DH-8 — empty lines ──────────────────────────────────────────────────────

function checkEmptyLines(lines: Line[], totals: Map<number, LineTotals>): CheckFinding[] {
  const affected: AffectedEntity[] = [];
  for (const line of lines) {
    const t = totalsFor(totals, line.id);
    if (t.plan === 0 && t.actual === 0) {
      affected.push({ entityType: "budget_line", entityId: line.id, label: lineLabel(line) });
    }
  }
  if (affected.length === 0) return [];

  const { shown, total } = truncate(affected);
  return [
    {
      id: "DH-8",
      category: "data-health",
      title: "Budget lines with no figures",
      severity: "info",
      description: `${total} budget line(s) have no budget and no spend for this year.`,
      remediation: null,
      affected: shown,
      affectedCount: total,
    },
  ];
}

// ─── runner ──────────────────────────────────────────────────────────────────

export async function runDataHealthChecks(year: number): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const run = async (
    id: string,
    title: string,
    fn: () => CheckFinding[] | Promise<CheckFinding[]>,
  ): Promise<void> => {
    const startedAt = Date.now();
    try {
      results.push({
        id,
        category: "data-health",
        title,
        ok: true,
        findings: await fn(),
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      results.push({
        id,
        category: "data-health",
        title,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        findings: [],
        durationMs: Date.now() - startedAt,
      });
    }
  };

  const lines = await db.select().from(budgetLinesTable);
  const totals = await loadTotals(year);

  await run("DH-1", "Duplicate budget lines", () => checkDuplicateLines(lines, totals));
  await run("DH-2", "Near-duplicate budget lines", () => checkNearDuplicateLines(lines, totals));
  await run("DH-3", "Budget and spend split across two lines", () => checkSplitPairs(lines, totals));
  await run("DH-4", "Inconsistent empty values", () => checkBlankRepresentation(lines));
  await run("DH-5", "Orphaned rows", () => checkOrphanedRows());
  await run("DH-6", "Category name drift", () => checkCategoryDrift(lines));
  await run("DH-7", "Unrecognised cost status", () => checkCostStatus(lines));
  await run("DH-8", "Budget lines with no figures", () => checkEmptyLines(lines, totals));

  return results;
}
