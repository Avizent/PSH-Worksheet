import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, budgetLinesTable, monthlyPlansTable, monthlyActualsTable } from "@workspace/db";
import { GetProjectionsQueryParams, GetProjectionsResponse } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get("/projections", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = GetProjectionsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }
  const year = queryParsed.data.year ?? 2026;

  const lines = await db.select().from(budgetLinesTable);

  const allPlans = await db
    .select()
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, year))
    .orderBy(monthlyPlansTable.month);

  const allActuals = await db
    .select()
    .from(monthlyActualsTable)
    .where(eq(monthlyActualsTable.year, year))
    .orderBy(monthlyActualsTable.month);

  const now = new Date();
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : (year < now.getFullYear() ? 12 : 0);

  const items = lines.map(line => {
    const linePlans = allPlans.filter(p => p.budgetLineId === line.id);
    const lineActuals = allActuals.filter(a => a.budgetLineId === line.id);

    const actualsByMonth = new Map(lineActuals.map(a => [a.month, Number(a.actualAmount)]));
    const plansByMonth = new Map(linePlans.map(p => [p.month, Number(p.plannedAmount)]));

    const isFixed = line.costStatus === "Fixed Cost";
    const pctChange = line.projectionPct / 100;

    let lastKnownActual: number | null = null;
    for (let m = currentMonth; m >= 1; m--) {
      const val = actualsByMonth.get(m);
      if (val != null && val > 0) {
        lastKnownActual = val;
        break;
      }
    }

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const planned = plansByMonth.get(m) ?? 0;
      const actual = actualsByMonth.get(m) ?? null;

      let projected: number | null = null;
      if (m > currentMonth && isFixed && lastKnownActual != null) {
        projected = Math.round(lastKnownActual * (1 + pctChange) * 100) / 100;
      }

      months.push({ month: m, planned, actual, projected });
    }

    return {
      budgetLineId: line.id,
      lineItem: line.lineItem,
      category: line.category,
      costStatus: line.costStatus,
      projectionPct: line.projectionPct,
      months,
    };
  });

  res.json(GetProjectionsResponse.parse({ year, items }));
}));

export default router;
