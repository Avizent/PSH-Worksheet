import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, budgetLinesTable, monthlyPlansTable, monthlyActualsTable } from "@workspace/db";
import { ListBudgetLinesWithMonthlyResponse, ListBudgetLinesWithMonthlyQueryParams } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get("/budget-lines/with-monthly", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = ListBudgetLinesWithMonthlyQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }
  const year = queryParsed.data.year;

  const lines = await db.select().from(budgetLinesTable).orderBy(budgetLinesTable.category, budgetLinesTable.lineItem);

  const now = new Date();
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : (year < now.getFullYear() ? 12 : 0);

  const result = await Promise.all(
    lines.map(async (line) => {
      const plans = await db
        .select()
        .from(monthlyPlansTable)
        .where(eq(monthlyPlansTable.budgetLineId, line.id))
        .orderBy(monthlyPlansTable.month);

      const actuals = await db
        .select()
        .from(monthlyActualsTable)
        .where(eq(monthlyActualsTable.budgetLineId, line.id))
        .orderBy(monthlyActualsTable.month);

      const filteredPlans = plans.filter((p) => p.year === year);
      const filteredActuals = actuals.filter((a) => a.year === year);

      const isFixed = line.costStatus === "Fixed Cost";
      const pctChange = line.projectionPct / 100;

      let lastKnownActual: number | null = null;
      if (isFixed) {
        for (let m = currentMonth; m >= 1; m--) {
          const act = filteredActuals.find(a => a.month === m);
          if (act && Number(act.actualAmount) > 0) {
            lastKnownActual = Number(act.actualAmount);
            break;
          }
        }
      }

      const projections = [];
      for (let m = 1; m <= 12; m++) {
        let projected: number | null = null;
        if (m > currentMonth && isFixed && lastKnownActual != null) {
          projected = Math.round(lastKnownActual * (1 + pctChange) * 100) / 100;
        }
        projections.push({ month: m, projected });
      }

      return {
        ...line,
        plans: filteredPlans,
        actuals: filteredActuals,
        projections,
      };
    })
  );

  res.json(ListBudgetLinesWithMonthlyResponse.parse(result));
}));

export default router;
