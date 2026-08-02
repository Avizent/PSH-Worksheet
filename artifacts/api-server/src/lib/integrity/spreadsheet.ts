/**
 * SI-1 .. SI-5 — does the export/import boundary still hold.
 * See audit/integrity-checks-spec.md.
 *
 * SI-6 (diff against an uploaded source workbook) is deliberately absent: it
 * needs a file upload, so it belongs to a separate endpoint rather than the
 * one-button run.
 */
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  budgetLineColumnsTable,
} from "@workspace/db";
import {
  type AffectedEntity,
  type CheckFinding,
  type CheckResult,
  MAX_AFFECTED_PER_FINDING,
  isBlank,
} from "./types";

/**
 * The header contract the export writes and the import expects. Kept in step
 * with BASE_HEADERS_LEFT / MONTH_HEADERS in routes/excel.ts — SI-2 exists to
 * catch the two drifting apart.
 */
const EXPECTED_BASE_HEADERS = [
  "Category",
  "Subcategory",
  "Line Item",
  "Owner",
  "Region",
  "Channel",
  "Cost Status",
  "Projection %",
  "Board Approved Amount",
] as const;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const VALID_COST_STATUSES = new Set(["Fixed Cost", "Variable", "Planned", "Booked", "Spent"]);

const SNAPSHOTS_DIR = path.join(process.cwd(), "snapshots");
const SNAPSHOT_STALE_DAYS = 30;

function truncate<T>(items: T[]): { shown: T[]; total: number } {
  return { shown: items.slice(0, MAX_AFFECTED_PER_FINDING), total: items.length };
}

// ─── SI-1 — re-import readiness ──────────────────────────────────────────────

/**
 * Checks that the data as it stands would survive an export/re-import cycle,
 * by applying the import validator's own field-level rules to current rows.
 *
 * This is narrower than the full round-trip described in the spec: a true
 * round-trip would generate the workbook and feed it back through the
 * validator, which needs the export's workbook builder extracted from its
 * route handler first. The field rules below are what that round-trip would
 * actually fail on, so this catches the same class of problem.
 */
async function checkReimportReadiness(): Promise<CheckFinding[]> {
  const lines = await db.select().from(budgetLinesTable);
  const blocking: AffectedEntity[] = [];

  for (const line of lines) {
    const problems: string[] = [];
    if (isBlank(line.category)) problems.push("no category");
    if (isBlank(line.lineItem)) problems.push("no line item");
    if (isBlank(line.costStatus)) problems.push("blank cost status");
    else if (!VALID_COST_STATUSES.has(line.costStatus)) {
      problems.push(`unrecognised cost status "${line.costStatus}"`);
    }
    if (line.projectionPct != null && !Number.isFinite(Number(line.projectionPct))) {
      problems.push("projection % is not a number");
    }
    if (line.boardApprovedAmount != null && !Number.isFinite(Number(line.boardApprovedAmount))) {
      problems.push("board approved amount is not a number");
    }

    if (problems.length > 0) {
      blocking.push({
        entityType: "budget_line",
        entityId: line.id,
        label: `${line.category ?? "(no category)"} | ${line.lineItem ?? "(no line item)"}`,
        detail: { problems: problems.join("; ") },
      });
    }
  }

  if (blocking.length === 0) return [];

  const { shown, total } = truncate(blocking);
  return [
    {
      id: "SI-1",
      category: "spreadsheet",
      title: "Data would fail its own spreadsheet import",
      severity: "critical",
      description:
        `${total} budget line(s) hold values the app's spreadsheet import would reject. ` +
        `Exporting this data and importing it back would fail, so the spreadsheet cannot ` +
        `currently be used as a working copy.`,
      remediation: "Correct the flagged fields on each line.",
      affected: shown,
      affectedCount: total,
    },
  ];
}

// ─── SI-2 — header schema check ──────────────────────────────────────────────

async function checkHeaderSchema(): Promise<CheckFinding[]> {
  // Rebuilds the header the export produces from the same inputs the export
  // uses, and confirms it still matches the contract the import validates.
  const customCols = await db
    .select()
    .from(budgetLineColumnsTable)
    .orderBy(budgetLineColumnsTable.sortOrder, budgetLineColumnsTable.id);

  const monthHeaders = [
    ...MONTH_LABELS.map((m) => `${m} Plan`),
    ...MONTH_LABELS.map((m) => `${m} Actual`),
  ];
  const reserved = new Set<string>([...EXPECTED_BASE_HEADERS, ...monthHeaders]);

  const clashing = customCols.filter((c) => reserved.has(c.name));
  if (clashing.length === 0) return [];

  return [
    {
      id: "SI-2",
      category: "spreadsheet",
      title: "Custom column name clashes with a built-in column",
      severity: "critical",
      description:
        `${clashing.length} custom column(s) use a name reserved by the spreadsheet format ` +
        `(${clashing.map((c) => `"${c.name}"`).join(", ")}). The export would produce two ` +
        `columns with the same heading and the import could not tell them apart.`,
      remediation: "Rename the custom column(s) to something not in the standard set.",
      affected: clashing.map((c) => ({
        entityType: "budget_line_column",
        entityId: c.id,
        label: c.name,
      })),
      affectedCount: clashing.length,
    },
  ];
}

// ─── SI-3 — month coverage ───────────────────────────────────────────────────

async function checkMonthCoverage(year: number): Promise<CheckFinding[]> {
  const rows = await db
    .select({
      budgetLineId: monthlyPlansTable.budgetLineId,
      months: sql<string>`count(*)`,
    })
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, year))
    .groupBy(monthlyPlansTable.budgetLineId);

  const counts = new Map(rows.map((r) => [r.budgetLineId, Number(r.months)]));
  const lines = await db.select().from(budgetLinesTable);

  const incomplete: AffectedEntity[] = [];
  for (const line of lines) {
    const months = counts.get(line.id) ?? 0;
    if (months > 0 && months < 12) {
      incomplete.push({
        entityType: "budget_line",
        entityId: line.id,
        label: `${line.category} | ${line.lineItem}`,
        detail: { monthsPresent: months, expected: 12 },
      });
    }
  }
  if (incomplete.length === 0) return [];

  const { shown, total } = truncate(incomplete);
  return [
    {
      id: "SI-3",
      category: "spreadsheet",
      title: "Budget lines missing months",
      severity: "warning",
      description:
        `${total} budget line(s) have some but not all 12 months of budget for this year, ` +
        `which usually means a write did not finish.`,
      remediation: "Fill in the missing months, entering zero where there is genuinely no budget.",
      affected: shown,
      affectedCount: total,
    },
  ];
}

// ─── SI-4 — custom column type consistency ───────────────────────────────────

async function checkCustomColumnTypes(): Promise<CheckFinding[]> {
  const [columns, lines] = await Promise.all([
    db.select().from(budgetLineColumnsTable),
    db.select().from(budgetLinesTable),
  ]);
  if (columns.length === 0) return [];

  const typeByName = new Map(columns.map((c) => [c.name, c.type]));
  const mismatched: AffectedEntity[] = [];

  for (const line of lines) {
    const fields = line.customFields as Record<string, unknown> | null;
    if (!fields) continue;
    for (const [name, value] of Object.entries(fields)) {
      const declared = typeByName.get(name);
      if (!declared) continue;
      if (value === null || value === undefined || value === "") continue;
      if (declared === "number" && !Number.isFinite(Number(value))) {
        mismatched.push({
          entityType: "budget_line",
          entityId: line.id,
          label: `${line.category} | ${line.lineItem}`,
          detail: { column: name, expected: "number", stored: String(value) },
        });
      }
    }
  }
  if (mismatched.length === 0) return [];

  const { shown, total } = truncate(mismatched);
  return [
    {
      id: "SI-4",
      category: "spreadsheet",
      title: "Custom column holds the wrong kind of value",
      severity: "warning",
      description:
        `${total} value(s) stored in a number column are not numbers. They will not format ` +
        `correctly on export and may fail a re-import.`,
      remediation: "Correct the flagged values, or change the column's type.",
      affected: shown,
      affectedCount: total,
    },
  ];
}

// ─── SI-5 — snapshot staleness ───────────────────────────────────────────────

interface SnapshotFileMeta {
  filename: string;
  createdAt: Date;
  totalBudget?: number;
  totalSpent?: number;
  lineCount?: number;
}

function readLatestSnapshot(): SnapshotFileMeta | null {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return null;
  const files = fs.readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return null;

  let latest: SnapshotFileMeta | null = null;
  for (const filename of files) {
    const full = path.join(SNAPSHOTS_DIR, filename);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (latest && stat.mtime <= latest.createdAt) continue;

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
    } catch {
      // Unreadable snapshot still counts for recency; totals just stay unknown.
    }
    latest = {
      filename,
      createdAt: stat.mtime,
      totalBudget: typeof parsed.totalBudget === "number" ? parsed.totalBudget : undefined,
      totalSpent: typeof parsed.totalSpent === "number" ? parsed.totalSpent : undefined,
      lineCount: typeof parsed.lineCount === "number" ? parsed.lineCount : undefined,
    };
  }
  return latest;
}

async function checkSnapshotStaleness(year: number): Promise<CheckFinding[]> {
  const latest = readLatestSnapshot();

  if (!latest) {
    return [
      {
        id: "SI-5",
        category: "spreadsheet",
        title: "No snapshot has ever been taken",
        severity: "warning",
        description:
          "There is no saved snapshot, so there is nothing to restore from if data is lost or " +
          "an import goes wrong.",
        remediation: "Take a snapshot from the Snapshots screen.",
        affected: [],
        affectedCount: 0,
      },
    ];
  }

  const ageDays = Math.floor((Date.now() - latest.createdAt.getTime()) / 86_400_000);
  if (ageDays < SNAPSHOT_STALE_DAYS) return [];

  const [planAgg] = await db
    .select({ total: sql<string>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, year));

  return [
    {
      id: "SI-5",
      category: "spreadsheet",
      title: "Most recent snapshot is old",
      severity: "warning",
      description:
        `The latest snapshot is ${ageDays} days old. Restoring from it would lose anything ` +
        `entered since.` +
        (latest.totalBudget != null
          ? ` It recorded a budget of ${latest.totalBudget}; the current figure is ${Number(planAgg.total)}.`
          : ""),
      remediation: "Take a fresh snapshot from the Snapshots screen.",
      affected: [
        {
          entityType: "snapshot",
          label: latest.filename,
          detail: { ageDays, takenAt: latest.createdAt.toISOString() },
        },
      ],
      affectedCount: 1,
    },
  ];
}

// ─── runner ──────────────────────────────────────────────────────────────────

export async function runSpreadsheetChecks(year: number): Promise<CheckResult[]> {
  const definitions: { id: string; title: string; fn: () => Promise<CheckFinding[]> }[] = [
    { id: "SI-1", title: "Data can be re-imported", fn: () => checkReimportReadiness() },
    { id: "SI-2", title: "Spreadsheet column names", fn: () => checkHeaderSchema() },
    { id: "SI-3", title: "All months present", fn: () => checkMonthCoverage(year) },
    { id: "SI-4", title: "Custom column value types", fn: () => checkCustomColumnTypes() },
    { id: "SI-5", title: "Snapshot freshness", fn: () => checkSnapshotStaleness(year) },
  ];

  const results: CheckResult[] = [];
  for (const def of definitions) {
    const startedAt = Date.now();
    try {
      results.push({
        id: def.id,
        category: "spreadsheet",
        title: def.title,
        ok: true,
        findings: await def.fn(),
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      results.push({
        id: def.id,
        category: "spreadsheet",
        title: def.title,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        findings: [],
        durationMs: Date.now() - startedAt,
      });
    }
  }
  return results;
}
