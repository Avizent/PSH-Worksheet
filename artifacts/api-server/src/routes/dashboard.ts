import { Router, type IRouter } from "express";
import { eq, isNull, sql } from "drizzle-orm";
import { db, budgetLinesTable, monthlyPlansTable, monthlyActualsTable, alertsTable } from "@workspace/db";
import { GetDashboardSummaryResponse, GetDashboardSummaryQueryParams } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get("/dashboard/summary", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = GetDashboardSummaryQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }
  const year = queryParsed.data.year;
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const monthsElapsed = year === now.getFullYear() ? currentMonth : (year < now.getFullYear() ? 12 : 0);

  const [planTotal] = await db
    .select({ total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, year));

  const [actualTotal] = await db
    .select({ total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)` })
    .from(monthlyActualsTable)
    .where(eq(monthlyActualsTable.year, year));

  const fixedLines = await db
    .select({ id: budgetLinesTable.id })
    .from(budgetLinesTable)
    .where(eq(budgetLinesTable.costStatus, "Fixed Cost"));

  let fixedRunRate = 0;
  if (fixedLines.length > 0) {
    const fixedIds = fixedLines.map((l) => l.id);
    const [fixedActuals] = await db
      .select({ total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`, count: sql<number>`COUNT(DISTINCT ${monthlyActualsTable.month})` })
      .from(monthlyActualsTable)
      .where(
        sql`${monthlyActualsTable.budgetLineId} IN (${sql.join(fixedIds.map(id => sql`${id}`), sql`, `)}) AND ${monthlyActualsTable.year} = ${year}`
      );
    const monthCount = Number(fixedActuals.count) || 1;
    fixedRunRate = Number(fixedActuals.total) / monthCount;
  }

  const [alertCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(alertsTable)
    .where(isNull(alertsTable.resolvedAt));

  const totalBudget = Number(planTotal.total);
  const spentYtd = Number(actualTotal.total);
  const remaining = totalBudget - spentYtd;
  const budgetUtilisation = totalBudget > 0 ? (spentYtd / totalBudget) * 100 : 0;

  const result = {
    totalBudget,
    spentYtd,
    remaining,
    fixedRunRate: Math.round(fixedRunRate * 100) / 100,
    activeAlerts: Number(alertCount.count),
    budgetUtilisation: Math.round(budgetUtilisation * 100) / 100,
    monthsElapsed,
    totalMonths: 12,
  };

  res.json(GetDashboardSummaryResponse.parse(result));
}));

export default router;
