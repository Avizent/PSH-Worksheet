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

      return {
        ...line,
        plans: filteredPlans,
        actuals: filteredActuals,
      };
    })
  );

  res.json(ListBudgetLinesWithMonthlyResponse.parse(result));
}));

export default router;
