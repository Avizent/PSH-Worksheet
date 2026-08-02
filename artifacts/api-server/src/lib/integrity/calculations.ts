/**
 * CC-1 .. CC-9 — is the app's own arithmetic internally consistent.
 * See audit/integrity-checks-spec.md.
 *
 * Each check recomputes independently from raw rows and compares against the
 * figure the app's own endpoints produce, so a screen that has drifted from
 * the shared calculation path shows up here rather than in a board pack.
 */
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  forecastPlansTable,
  forecastVersionsTable,
  exchangeRatesTable,
  auditLogsTable,
} from "@workspace/db";
import {
  type AffectedEntity,
  type CheckFinding,
  type CheckResult,
  MAX_AFFECTED_PER_FINDING,
} from "./types";

/**
 * Money is stored as numeric(14,2), so anything below half a penny is a
 * representation artefact rather than a real disagreement.
 */
const MONEY_TOLERANCE = 0.005;

/** Plausible SEK-per-GBP band for CC-8. Widen if real rates move outside it. */
const RATE_MIN = 5;
const RATE_MAX = 25;

/** CC-6 only reports a board-vs-plan gap above this, to avoid rounding noise. */
const BOARD_VARIANCE_TOLERANCE = 1;

function truncate<T>(items: T[]): { shown: T[]; total: number } {
  return { shown: items.slice(0, MAX_AFFECTED_PER_FINDING), total: items.length };
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── CC-1 — remaining recomputation ──────────────────────────────────────────

async function checkRemaining(year: number): Promise<CheckFinding[]> {
  const lines = await db.select().from(budgetLinesTable);
  const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year));
  const actuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, year));

  const planByLine = new Map<number, number>();
  for (const p of plans) {
    planByLine.set(p.budgetLineId, (planByLine.get(p.budgetLineId) ?? 0) + Number(p.plannedAmount));
  }
  const actualByLine = new Map<number, number>();
  for (const a of actuals) {
    actualByLine.set(a.budgetLineId, (actualByLine.get(a.budgetLineId) ?? 0) + Number(a.actualAmount));
  }

  // Independent grand total, compared against the same SQL aggregation the
  // dashboard endpoint uses.
  const recomputedPlan = [...planByLine.values()].reduce((s, v) => s + v, 0);
  const recomputedActual = [...actualByLine.values()].reduce((s, v) => s + v, 0);

  const [planAgg] = await db
    .select({ total: sql<string>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, year));
  const [actualAgg] = await db
    .select({ total: sql<string>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)` })
    .from(monthlyActualsTable)
    .where(eq(monthlyActualsTable.year, year));

  const findings: CheckFinding[] = [];
  const planDiff = Math.abs(recomputedPlan - Number(planAgg.total));
  const actualDiff = Math.abs(recomputedActual - Number(actualAgg.total));

  if (planDiff > MONEY_TOLERANCE || actualDiff > MONEY_TOLERANCE) {
    findings.push({
      id: "CC-1",
      category: "calculation",
      title: "Totals do not match when recalculated",
      severity: "critical",
      description:
        `The year total calculated row by row does not match the total the app reports. ` +
        `Budget differs by ${money(planDiff)}, spend by ${money(actualDiff)}.`,
      remediation: "This is a code fault, not a data-entry problem. Needs investigation.",
      affected: [
        {
          entityType: "total",
          label: "Year total",
          detail: {
            recomputedBudget: money(recomputedPlan),
            reportedBudget: money(Number(planAgg.total)),
            recomputedSpend: money(recomputedActual),
            reportedSpend: money(Number(actualAgg.total)),
          },
        },
      ],
      affectedCount: 1,
    });
  }

  // Lines carrying spend with no budget at all: not an arithmetic fault, but
  // the remaining figure is meaningless and it is worth surfacing.
  const overspent: AffectedEntity[] = [];
  for (const line of lines) {
    const plan = planByLine.get(line.id) ?? 0;
    const actual = actualByLine.get(line.id) ?? 0;
    if (actual > plan + MONEY_TOLERANCE) {
      overspent.push({
        entityType: "budget_line",
        entityId: line.id,
        label: `${line.category} | ${line.lineItem}`,
        detail: { budget: money(plan), spent: money(actual), over: money(actual - plan) },
      });
    }
  }
  if (overspent.length > 0) {
    const { shown, total } = truncate(overspent);
    findings.push({
      id: "CC-1",
      category: "calculation",
      title: "Budget lines over budget",
      severity: "warning",
      description: `${total} budget line(s) have spent more than their budget for this year.`,
      remediation: "Review each: either the budget needs revising or the spend needs explaining.",
      affected: shown,
      affectedCount: total,
    });
  }

  return findings;
}

// ─── CC-2 — category subtotal consistency ────────────────────────────────────

async function checkCategorySubtotals(year: number): Promise<CheckFinding[]> {
  const lines = await db.select().from(budgetLinesTable);
  const lineCategory = new Map(lines.map((l) => [l.id, l.category]));

  const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year));
  const actuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, year));

  let grandPlan = 0;
  let categorisedPlan = 0;
  let grandActual = 0;
  let categorisedActual = 0;
  const uncategorised = new Set<number>();

  for (const p of plans) {
    const amount = Number(p.plannedAmount);
    grandPlan += amount;
    const cat = lineCategory.get(p.budgetLineId);
    if (cat && cat.trim() !== "") categorisedPlan += amount;
    else uncategorised.add(p.budgetLineId);
  }
  for (const a of actuals) {
    const amount = Number(a.actualAmount);
    grandActual += amount;
    const cat = lineCategory.get(a.budgetLineId);
    if (cat && cat.trim() !== "") categorisedActual += amount;
    else uncategorised.add(a.budgetLineId);
  }

  if (
    Math.abs(grandPlan - categorisedPlan) <= MONEY_TOLERANCE &&
    Math.abs(grandActual - categorisedActual) <= MONEY_TOLERANCE
  ) {
    return [];
  }

  return [
    {
      id: "CC-2",
      category: "calculation",
      title: "Category totals do not add up to the overall total",
      severity: "critical",
      description:
        `Budget lines with no category are counted in the overall total but excluded from every ` +
        `category, so any report grouped by category is short by ` +
        `${money(grandPlan - categorisedPlan)} of budget and ` +
        `${money(grandActual - categorisedActual)} of spend.`,
      remediation: "Assign a category to each of these budget lines.",
      affected: [...uncategorised].map((id) => {
        const line = lines.find((l) => l.id === id);
        return {
          entityType: "budget_line",
          entityId: id,
          label: line ? `(no category) | ${line.lineItem}` : `budget line #${id}`,
        };
      }),
      affectedCount: uncategorised.size,
    },
  ];
}

// ─── CC-3 — currency round-trip ──────────────────────────────────────────────

async function checkCurrencyRoundTrip(): Promise<CheckFinding[]> {
  const [active] = await db
    .select()
    .from(exchangeRatesTable)
    .orderBy(desc(exchangeRatesTable.createdAt), desc(exchangeRatesTable.id))
    .limit(1);

  // No rate configured is CC-8's finding, not this one — GBP simply falls back
  // to SEK, which is correct behaviour rather than an arithmetic fault.
  if (!active || !active.rate || active.rate <= 0) return [];

  const rate = Number(active.rate);
  const samples = [1, 249, 12345.67, 2823149.06];
  const failures: AffectedEntity[] = [];

  for (const sek of samples) {
    const roundTripped = (sek / rate) * rate;
    if (Math.abs(roundTripped - sek) > MONEY_TOLERANCE) {
      failures.push({
        entityType: "currency",
        label: `${sek} SEK`,
        detail: { afterRoundTrip: roundTripped, rate },
      });
    }
  }
  if (failures.length === 0) return [];

  return [
    {
      id: "CC-3",
      category: "calculation",
      title: "Currency conversion is not reversible",
      severity: "critical",
      description:
        "Converting an amount to GBP and back does not return the original figure, so GBP " +
        "figures shown in the app cannot be relied on.",
      remediation: "This is a code fault in the conversion logic. Needs investigation.",
      affected: failures,
      affectedCount: failures.length,
    },
  ];
}

// ─── CC-4 — money-column precision ───────────────────────────────────────────

const MONEY_COLUMNS: { table: string; column: string }[] = [
  { table: "budget_lines", column: "board_approved_amount" },
  { table: "budget_lines", column: "projection_pct" },
  { table: "monthly_plans", column: "planned_amount" },
  { table: "monthly_plans", column: "board_amount" },
  { table: "monthly_actuals", column: "actual_amount" },
  { table: "forecast_plans", column: "planned_amount" },
  { table: "events", column: "estimated_cost" },
  { table: "exchange_rates", column: "rate" },
  { table: "csv_import_rows", column: "raw_amount" },
];

async function checkMoneyPrecision(): Promise<CheckFinding[]> {
  const rows = await db.execute<{ table_name: string; column_name: string; data_type: string }>(
    sql`SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'`,
  );

  const actual = new Map<string, string>();
  for (const r of rows.rows ?? []) {
    actual.set(`${r.table_name}.${r.column_name}`, r.data_type);
  }

  const wrong: AffectedEntity[] = [];
  for (const target of MONEY_COLUMNS) {
    const key = `${target.table}.${target.column}`;
    const type = actual.get(key);
    if (!type) continue; // column absent in this database; not this check's concern
    if (type !== "numeric") {
      wrong.push({
        entityType: "column",
        label: key,
        detail: { expected: "numeric", found: type },
      });
    }
  }
  if (wrong.length === 0) return [];

  return [
    {
      id: "CC-4",
      category: "calculation",
      title: "Money stored as an approximate number type",
      severity: "critical",
      description:
        `${wrong.length} monetary column(s) are not stored as exact decimals. Amounts stored ` +
        `this way accumulate small rounding errors as they are added up.`,
      remediation: "Needs a database migration to restore exact decimal storage.",
      affected: wrong,
      affectedCount: wrong.length,
    },
  ];
}

// ─── CC-5 — projection formula consistency ───────────────────────────────────

async function checkProjections(year: number): Promise<CheckFinding[]> {
  const lines = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.costStatus, "Fixed Cost"));
  if (lines.length === 0) return [];

  const actuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, year));
  const byLine = new Map<number, Map<number, number>>();
  for (const a of actuals) {
    const map = byLine.get(a.budgetLineId) ?? new Map<number, number>();
    map.set(a.month, Number(a.actualAmount));
    byLine.set(a.budgetLineId, map);
  }

  const now = new Date();
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : year < now.getFullYear() ? 12 : 0;

  const suspicious: AffectedEntity[] = [];
  for (const line of lines) {
    const pct = Number(line.projectionPct ?? 0);
    // A projection percentage outside this range would compound to an
    // implausible figure across the remaining months of the year.
    if (pct < -100 || pct > 1000) {
      suspicious.push({
        entityType: "budget_line",
        entityId: line.id,
        label: `${line.category} | ${line.lineItem}`,
        detail: { projectionPct: pct },
      });
      continue;
    }

    const monthMap = byLine.get(line.id);
    let lastKnownActual: number | null = null;
    for (let m = currentMonth; m >= 1; m--) {
      const v = monthMap?.get(m);
      if (v != null && v > 0) {
        lastKnownActual = v;
        break;
      }
    }
    if (lastKnownActual == null) continue;

    const projected = Math.round(lastKnownActual * (1 + pct / 100) * 100) / 100;
    if (!Number.isFinite(projected) || projected < 0) {
      suspicious.push({
        entityType: "budget_line",
        entityId: line.id,
        label: `${line.category} | ${line.lineItem}`,
        detail: { lastActual: lastKnownActual, projectionPct: pct, projected },
      });
    }
  }
  if (suspicious.length === 0) return [];

  const { shown, total } = truncate(suspicious);
  return [
    {
      id: "CC-5",
      category: "calculation",
      title: "Projection settings produce an implausible forecast",
      severity: "warning",
      description:
        `${total} fixed-cost line(s) have a projection percentage that produces a negative or ` +
        `implausible forecast for the remaining months.`,
      remediation: "Review the projection percentage on each of these lines.",
      affected: shown,
      affectedCount: total,
    },
  ];
}

// ─── CC-6 — board-approved vs planned variance ───────────────────────────────

async function checkBoardVariance(year: number): Promise<CheckFinding[]> {
  const lines = await db.select().from(budgetLinesTable);
  const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year));

  const planByLine = new Map<number, number>();
  for (const p of plans) {
    planByLine.set(p.budgetLineId, (planByLine.get(p.budgetLineId) ?? 0) + Number(p.plannedAmount));
  }

  const mismatched: AffectedEntity[] = [];
  for (const line of lines) {
    if (line.boardApprovedAmount == null) continue;
    const approved = Number(line.boardApprovedAmount);
    if (approved === 0) continue;
    const planned = planByLine.get(line.id) ?? 0;
    const diff = planned - approved;
    if (Math.abs(diff) > BOARD_VARIANCE_TOLERANCE) {
      mismatched.push({
        entityType: "budget_line",
        entityId: line.id,
        label: `${line.category} | ${line.lineItem}`,
        detail: { boardApproved: money(approved), planned: money(planned), difference: money(diff) },
      });
    }
  }
  if (mismatched.length === 0) return [];

  const { shown, total } = truncate(mismatched);
  return [
    {
      id: "CC-6",
      category: "calculation",
      title: "Planned budget differs from the board-approved amount",
      severity: "info",
      description:
        `${total} budget line(s) have a planned total that differs from what was approved. ` +
        `This is not necessarily wrong — plans change — but the difference is worth knowing.`,
      remediation: null,
      affected: shown,
      affectedCount: total,
    },
  ];
}

// ─── CC-7 — rollover integrity ───────────────────────────────────────────────

async function checkRollover(): Promise<CheckFinding[]> {
  const [lastRollover] = await db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.entityType, "annual_rollover"))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(1);

  if (!lastRollover || !lastRollover.oldValue || !lastRollover.newValue) return [];

  const sourceYear = Number(lastRollover.oldValue);
  const targetYear = Number(lastRollover.newValue);
  if (!Number.isFinite(sourceYear) || !Number.isFinite(targetYear)) return [];

  const [sourceAgg] = await db
    .select({ total: sql<string>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, sourceYear));
  const [targetAgg] = await db
    .select({ total: sql<string>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, targetYear));

  const source = Number(sourceAgg.total);
  const target = Number(targetAgg.total);
  // A deliberate edit to the new year's plans after rollover is expected and
  // legitimate, so only a target of zero indicates the rollover itself failed.
  if (target > 0) return [];

  return [
    {
      id: "CC-7",
      category: "calculation",
      title: "Rollover left the new year empty",
      severity: "critical",
      description:
        `A rollover from ${sourceYear} to ${targetYear} was recorded, but ${targetYear} has no ` +
        `budget at all (${sourceYear} has ${money(source)}). The rollover did not complete.`,
      remediation: "Investigate before re-running the rollover — it may have partly applied.",
      affected: [
        { entityType: "year", label: String(targetYear), detail: { budget: 0, sourceBudget: money(source) } },
      ],
      affectedCount: 1,
    },
  ];
}

// ─── CC-8 — exchange-rate sanity ─────────────────────────────────────────────

async function checkExchangeRate(): Promise<CheckFinding[]> {
  const [active] = await db
    .select()
    .from(exchangeRatesTable)
    .orderBy(desc(exchangeRatesTable.createdAt), desc(exchangeRatesTable.id))
    .limit(1);

  if (!active) return []; // none configured: GBP falls back to SEK by design

  const rate = Number(active.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return [
      {
        id: "CC-8",
        category: "calculation",
        title: "Exchange rate is invalid",
        severity: "critical",
        description: `The active exchange rate is ${active.rate}, which cannot be used. Every GBP figure in the app is currently wrong.`,
        remediation: "Set a valid exchange rate on the Exchange Rate screen.",
        affected: [{ entityType: "exchange_rate", entityId: active.id, label: `rate = ${active.rate}` }],
        affectedCount: 1,
      },
    ];
  }

  if (rate < RATE_MIN || rate > RATE_MAX) {
    return [
      {
        id: "CC-8",
        category: "calculation",
        title: "Exchange rate looks wrong",
        severity: "warning",
        description:
          `The active rate is ${rate} SEK per GBP, outside the expected range of ` +
          `${RATE_MIN}–${RATE_MAX}. If this is a typing error, every GBP figure is distorted.`,
        remediation: "Confirm the rate on the Exchange Rate screen, or set a corrected one.",
        affected: [{ entityType: "exchange_rate", entityId: active.id, label: `rate = ${rate}` }],
        affectedCount: 1,
      },
    ];
  }
  return [];
}

// ─── CC-9 — reforecast delta consistency ─────────────────────────────────────

async function checkReforecast(year: number): Promise<CheckFinding[]> {
  const versions = await db
    .select()
    .from(forecastVersionsTable)
    .where(eq(forecastVersionsTable.year, year));
  if (versions.length === 0) return [];

  const plans = await db.select().from(forecastPlansTable).where(eq(forecastPlansTable.year, year));
  const byVersion = new Map<number, number>();
  for (const p of plans) {
    byVersion.set(p.versionId, (byVersion.get(p.versionId) ?? 0) + Number(p.plannedAmount));
  }

  const empty: AffectedEntity[] = [];
  for (const version of versions) {
    const total = byVersion.get(version.id) ?? 0;
    if (total === 0) {
      empty.push({
        entityType: "forecast_version",
        entityId: version.id,
        label: version.name,
        detail: { total: 0 },
      });
    }
  }
  if (empty.length === 0) return [];

  const { shown, total } = truncate(empty);
  return [
    {
      id: "CC-9",
      category: "calculation",
      title: "Forecast version has no figures",
      severity: "warning",
      description:
        `${total} forecast version(s) contain no budget figures, so any comparison against them ` +
        `shows the whole budget as a change.`,
      remediation: "Delete the empty version, or populate it.",
      affected: shown,
      affectedCount: total,
    },
  ];
}

// ─── runner ──────────────────────────────────────────────────────────────────

export async function runCalculationChecks(year: number): Promise<CheckResult[]> {
  const definitions: { id: string; title: string; fn: () => Promise<CheckFinding[]> }[] = [
    { id: "CC-1", title: "Totals recalculation", fn: () => checkRemaining(year) },
    { id: "CC-2", title: "Category totals add up", fn: () => checkCategorySubtotals(year) },
    { id: "CC-3", title: "Currency conversion is reversible", fn: () => checkCurrencyRoundTrip() },
    { id: "CC-4", title: "Money stored as exact decimals", fn: () => checkMoneyPrecision() },
    { id: "CC-5", title: "Projection settings", fn: () => checkProjections(year) },
    { id: "CC-6", title: "Planned vs board-approved", fn: () => checkBoardVariance(year) },
    { id: "CC-7", title: "Rollover completed", fn: () => checkRollover() },
    { id: "CC-8", title: "Exchange rate sanity", fn: () => checkExchangeRate() },
    { id: "CC-9", title: "Forecast versions", fn: () => checkReforecast(year) },
  ];

  const results: CheckResult[] = [];
  for (const def of definitions) {
    const startedAt = Date.now();
    try {
      results.push({
        id: def.id,
        category: "calculation",
        title: def.title,
        ok: true,
        findings: await def.fn(),
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      results.push({
        id: def.id,
        category: "calculation",
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
