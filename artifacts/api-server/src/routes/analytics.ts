import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, budgetLinesTable, monthlyPlansTable, monthlyActualsTable } from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get("/analytics/owner-breakdown", asyncHandler(async (req, res): Promise<void> => {
  const year = parseInt(req.query.year as string) || 2026;

  const planned = await db
    .select({
      owner: budgetLinesTable.owner,
      total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyPlansTable, sql`${monthlyPlansTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyPlansTable.year} = ${year}`)
    .groupBy(budgetLinesTable.owner);

  const actual = await db
    .select({
      owner: budgetLinesTable.owner,
      total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyActualsTable, sql`${monthlyActualsTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyActualsTable.year} = ${year}`)
    .groupBy(budgetLinesTable.owner);

  const actualMap = new Map(actual.map(a => [a.owner, Number(a.total)]));
  const data = planned.map(p => ({
    owner: p.owner || "Unknown",
    planned: Number(p.total),
    actual: actualMap.get(p.owner) ?? 0,
  }));

  res.json(data);
}));

router.get("/analytics/regional-investment", asyncHandler(async (req, res): Promise<void> => {
  const year = parseInt(req.query.year as string) || 2026;

  const planned = await db
    .select({
      region: budgetLinesTable.region,
      month: monthlyPlansTable.month,
      total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyPlansTable, sql`${monthlyPlansTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyPlansTable.year} = ${year}`)
    .groupBy(budgetLinesTable.region, monthlyPlansTable.month);

  const actual = await db
    .select({
      region: budgetLinesTable.region,
      month: monthlyActualsTable.month,
      total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyActualsTable, sql`${monthlyActualsTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyActualsTable.year} = ${year}`)
    .groupBy(budgetLinesTable.region, monthlyActualsTable.month);

  const quarters = ["Q1", "Q2", "Q3", "Q4"];
  const regionSet = new Set<string>();
  const plannedByRegionQuarter = new Map<string, number>();
  const actualByRegionQuarter = new Map<string, number>();

  for (const row of planned) {
    const region = row.region || "Global";
    regionSet.add(region);
    if (row.month == null) continue;
    const q = Math.floor((row.month - 1) / 3);
    const key = `${region}-${q}`;
    plannedByRegionQuarter.set(key, (plannedByRegionQuarter.get(key) ?? 0) + Number(row.total));
  }

  for (const row of actual) {
    const region = row.region || "Global";
    if (row.month == null) continue;
    const q = Math.floor((row.month - 1) / 3);
    const key = `${region}-${q}`;
    actualByRegionQuarter.set(key, (actualByRegionQuarter.get(key) ?? 0) + Number(row.total));
  }

  const regions = Array.from(regionSet).sort();
  const data = quarters.map((label, qi) => {
    const entry: Record<string, unknown> = { quarter: label };
    for (const r of regions) {
      const key = `${r}-${qi}`;
      entry[`${r}_planned`] = plannedByRegionQuarter.get(key) ?? 0;
      entry[`${r}_actual`] = actualByRegionQuarter.get(key) ?? 0;
    }
    return entry;
  });

  res.json({ regions, quarters: data });
}));

router.get("/analytics/fixed-vs-variable", asyncHandler(async (req, res): Promise<void> => {
  const year = parseInt(req.query.year as string) || 2026;

  const planned = await db
    .select({
      costStatus: budgetLinesTable.costStatus,
      month: monthlyPlansTable.month,
      total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyPlansTable, sql`${monthlyPlansTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyPlansTable.year} = ${year}`)
    .groupBy(budgetLinesTable.costStatus, monthlyPlansTable.month);

  const actual = await db
    .select({
      costStatus: budgetLinesTable.costStatus,
      month: monthlyActualsTable.month,
      total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyActualsTable, sql`${monthlyActualsTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyActualsTable.year} = ${year}`)
    .groupBy(budgetLinesTable.costStatus, monthlyActualsTable.month);

  const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthly: Array<{ month: number; label: string; fixedPlanned: number; variablePlanned: number; fixedActual: number; variableActual: number }> = [];

  const fixedPlannedMap = new Map<number, number>();
  const variablePlannedMap = new Map<number, number>();
  const fixedActualMap = new Map<number, number>();
  const variableActualMap = new Map<number, number>();

  for (const row of planned) {
    if (row.month == null) continue;
    const isFixed = row.costStatus === "Fixed Cost";
    const map = isFixed ? fixedPlannedMap : variablePlannedMap;
    map.set(row.month, (map.get(row.month) ?? 0) + Number(row.total));
  }

  for (const row of actual) {
    if (row.month == null) continue;
    const isFixed = row.costStatus === "Fixed Cost";
    const map = isFixed ? fixedActualMap : variableActualMap;
    map.set(row.month, (map.get(row.month) ?? 0) + Number(row.total));
  }

  for (let m = 1; m <= 12; m++) {
    monthly.push({
      month: m,
      label: MONTH_LABELS[m - 1],
      fixedPlanned: fixedPlannedMap.get(m) ?? 0,
      variablePlanned: variablePlannedMap.get(m) ?? 0,
      fixedActual: fixedActualMap.get(m) ?? 0,
      variableActual: variableActualMap.get(m) ?? 0,
    });
  }

  res.json(monthly);
}));

router.get("/analytics/category-burndown", asyncHandler(async (req, res): Promise<void> => {
  const year = parseInt(req.query.year as string) || 2026;

  const categoryPlanned = await db
    .select({
      category: budgetLinesTable.category,
      total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyPlansTable, sql`${monthlyPlansTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyPlansTable.year} = ${year}`)
    .groupBy(budgetLinesTable.category);

  const categoryActualByMonth = await db
    .select({
      category: budgetLinesTable.category,
      month: monthlyActualsTable.month,
      total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyActualsTable, sql`${monthlyActualsTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyActualsTable.year} = ${year}`)
    .groupBy(budgetLinesTable.category, monthlyActualsTable.month);

  const budgetMap = new Map(categoryPlanned.map(c => [c.category, Number(c.total)]));
  const categories = Array.from(budgetMap.keys()).sort();

  const actualByCatMonth = new Map<string, number>();
  for (const row of categoryActualByMonth) {
    if (row.month == null) continue;
    const key = `${row.category}-${row.month}`;
    actualByCatMonth.set(key, Number(row.total));
  }

  const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthly = [];

  for (let m = 1; m <= 12; m++) {
    const entry: Record<string, unknown> = { month: m, label: MONTH_LABELS[m - 1] };
    for (const cat of categories) {
      let cumActual = 0;
      for (let pm = 1; pm <= m; pm++) {
        cumActual += actualByCatMonth.get(`${cat}-${pm}`) ?? 0;
      }
      entry[cat] = (budgetMap.get(cat) ?? 0) - cumActual;
    }
    monthly.push(entry);
  }

  res.json({ categories, monthly });
}));

router.get("/analytics/board-variance", asyncHandler(async (req, res): Promise<void> => {
  const year = parseInt(req.query.year as string) || 2026;

  const lines = await db
    .select({
      id: budgetLinesTable.id,
      lineItem: budgetLinesTable.lineItem,
      category: budgetLinesTable.category,
      boardApprovedAmount: budgetLinesTable.boardApprovedAmount,
      currentPlan: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyPlansTable, sql`${monthlyPlansTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyPlansTable.year} = ${year}`)
    .groupBy(budgetLinesTable.id, budgetLinesTable.lineItem, budgetLinesTable.category, budgetLinesTable.boardApprovedAmount);

  const data = lines
    .filter(l => l.boardApprovedAmount != null && l.boardApprovedAmount > 0)
    .map(l => ({
      id: l.id,
      lineItem: l.lineItem,
      category: l.category,
      boardApproved: Number(l.boardApprovedAmount),
      currentPlan: Number(l.currentPlan),
      variance: Number(l.currentPlan) - Number(l.boardApprovedAmount),
      variancePct: Number(l.boardApprovedAmount) > 0
        ? ((Number(l.currentPlan) - Number(l.boardApprovedAmount)) / Number(l.boardApprovedAmount)) * 100
        : 0,
    }))
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  res.json(data);
}));

export default router;
