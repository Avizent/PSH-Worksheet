import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, monthlyPlansTable, monthlyActualsTable, budgetLinesTable } from "@workspace/db";
import { GetDashboardChartsQueryParams, GetDashboardChartsResponse } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const router: IRouter = Router();

router.get("/dashboard/charts", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = GetDashboardChartsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }
  const year = queryParsed.data.year ?? 2026;

  const monthlyPlanned = await db
    .select({
      month: monthlyPlansTable.month,
      total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
    })
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, year))
    .groupBy(monthlyPlansTable.month)
    .orderBy(monthlyPlansTable.month);

  const monthlyActual = await db
    .select({
      month: monthlyActualsTable.month,
      total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
    })
    .from(monthlyActualsTable)
    .where(eq(monthlyActualsTable.year, year))
    .groupBy(monthlyActualsTable.month)
    .orderBy(monthlyActualsTable.month);

  const actualMap = new Map(monthlyActual.map(a => [a.month, Number(a.total)]));
  const plannedMap = new Map(monthlyPlanned.map(p => [p.month, Number(p.total)]));

  let cumPlanned = 0;
  let cumActual = 0;
  const monthly = [];

  for (let m = 1; m <= 12; m++) {
    const planned = plannedMap.get(m) ?? 0;
    const actual = actualMap.get(m) ?? 0;
    cumPlanned += planned;
    cumActual += actual;
    monthly.push({
      month: m,
      monthLabel: MONTH_LABELS[m - 1],
      planned,
      actual,
      cumPlanned,
      cumActual,
    });
  }

  const categoryPlanned = await db
    .select({
      category: budgetLinesTable.category,
      total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyPlansTable, sql`${monthlyPlansTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyPlansTable.year} = ${year}`)
    .groupBy(budgetLinesTable.category)
    .orderBy(budgetLinesTable.category);

  const categoryActual = await db
    .select({
      category: budgetLinesTable.category,
      total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyActualsTable, sql`${monthlyActualsTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyActualsTable.year} = ${year}`)
    .groupBy(budgetLinesTable.category)
    .orderBy(budgetLinesTable.category);

  const actualByCat = new Map(categoryActual.map(c => [c.category, Number(c.total)]));
  const categories = categoryPlanned.map(c => ({
    category: c.category,
    planned: Number(c.total),
    actual: actualByCat.get(c.category) ?? 0,
  }));

  const channelPlanned = await db
    .select({
      channel: budgetLinesTable.channel,
      total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyPlansTable, sql`${monthlyPlansTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyPlansTable.year} = ${year}`)
    .groupBy(budgetLinesTable.channel);

  const channelActual = await db
    .select({
      channel: budgetLinesTable.channel,
      total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
    })
    .from(budgetLinesTable)
    .leftJoin(monthlyActualsTable, sql`${monthlyActualsTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyActualsTable.year} = ${year}`)
    .groupBy(budgetLinesTable.channel);

  const normalizeChannel = (c: string | null): string => c && c.length > 0 ? c : "unassigned";
  const actualByCh = new Map<string, number>();
  for (const row of channelActual) {
    const key = normalizeChannel(row.channel);
    actualByCh.set(key, (actualByCh.get(key) ?? 0) + Number(row.total));
  }
  const plannedByCh = new Map<string, number>();
  for (const row of channelPlanned) {
    const key = normalizeChannel(row.channel);
    plannedByCh.set(key, (plannedByCh.get(key) ?? 0) + Number(row.total));
  }
  const channelKeys = new Set<string>([...plannedByCh.keys(), ...actualByCh.keys()]);
  const channels = Array.from(channelKeys).sort().map(ch => ({
    channel: ch,
    planned: plannedByCh.get(ch) ?? 0,
    actual: actualByCh.get(ch) ?? 0,
  }));

  res.json(GetDashboardChartsResponse.parse({ monthly, categories, channels }));
}));

export default router;
