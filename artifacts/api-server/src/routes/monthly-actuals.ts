import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, monthlyActualsTable } from "@workspace/db";
import {
  CreateMonthlyActualBody,
  UpdateMonthlyActualBody,
  UpdateMonthlyActualParams,
  ListMonthlyActualsResponse,
  ListMonthlyActualsResponseItem,
  UpdateMonthlyActualResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get("/monthly-actuals", asyncHandler(async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.budgetLineId) {
    conditions.push(eq(monthlyActualsTable.budgetLineId, Number(req.query.budgetLineId)));
  }
  if (req.query.year) {
    conditions.push(eq(monthlyActualsTable.year, Number(req.query.year)));
  }
  const rows = conditions.length > 0
    ? await db.select().from(monthlyActualsTable).where(and(...conditions)).orderBy(monthlyActualsTable.month)
    : await db.select().from(monthlyActualsTable).orderBy(monthlyActualsTable.month);
  res.json(ListMonthlyActualsResponse.parse(rows));
}));

router.post("/monthly-actuals", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateMonthlyActualBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(monthlyActualsTable).values(parsed.data).returning();
  res.status(201).json(ListMonthlyActualsResponseItem.parse(row));
}));

router.patch("/monthly-actuals/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateMonthlyActualParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateMonthlyActualBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.update(monthlyActualsTable).set(parsed.data).where(eq(monthlyActualsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Monthly actual not found" });
    return;
  }
  res.json(UpdateMonthlyActualResponse.parse(row));
}));

export default router;
