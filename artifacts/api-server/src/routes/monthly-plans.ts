import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, monthlyPlansTable } from "@workspace/db";
import {
  CreateMonthlyPlanBody,
  UpdateMonthlyPlanBody,
  UpdateMonthlyPlanParams,
  ListMonthlyPlansResponse,
  ListMonthlyPlansResponseItem,
  UpdateMonthlyPlanResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get("/monthly-plans", asyncHandler(async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.budgetLineId) {
    conditions.push(eq(monthlyPlansTable.budgetLineId, Number(req.query.budgetLineId)));
  }
  if (req.query.year) {
    conditions.push(eq(monthlyPlansTable.year, Number(req.query.year)));
  }
  const rows = conditions.length > 0
    ? await db.select().from(monthlyPlansTable).where(and(...conditions)).orderBy(monthlyPlansTable.month)
    : await db.select().from(monthlyPlansTable).orderBy(monthlyPlansTable.month);
  res.json(ListMonthlyPlansResponse.parse(rows));
}));

router.post("/monthly-plans", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateMonthlyPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(monthlyPlansTable).values(parsed.data).returning();
  res.status(201).json(ListMonthlyPlansResponseItem.parse(row));
}));

router.patch("/monthly-plans/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateMonthlyPlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateMonthlyPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.update(monthlyPlansTable).set(parsed.data).where(eq(monthlyPlansTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Monthly plan not found" });
    return;
  }
  res.json(UpdateMonthlyPlanResponse.parse(row));
}));

export default router;
