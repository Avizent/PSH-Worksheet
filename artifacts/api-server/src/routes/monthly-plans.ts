import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, monthlyPlansTable } from "@workspace/db";
import { triggerAlertEvaluation } from "../lib/runAlertEvaluation";
import {
  CreateMonthlyPlanBody,
  UpdateMonthlyPlanBody,
  UpdateMonthlyPlanParams,
  ListMonthlyPlansQueryParams,
  ListMonthlyPlansResponse,
  ListMonthlyPlansResponseItem,
  UpdateMonthlyPlanResponse,
  UpsertMonthlyPlanByLineParams,
  UpsertMonthlyPlanByLineBody,
  UpsertMonthlyPlanByLineResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { writeAuditLog } from "../middleware/auditLog";

const router: IRouter = Router();

router.get("/monthly-plans", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = ListMonthlyPlansQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }
  const { budgetLineId, year } = queryParsed.data;
  const conditions = [];
  if (budgetLineId != null) {
    conditions.push(eq(monthlyPlansTable.budgetLineId, budgetLineId));
  }
  if (year != null) {
    conditions.push(eq(monthlyPlansTable.year, year));
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
  await writeAuditLog({
    action: "create",
    entityType: "monthly_plan",
    entityId: row.id,
    field: "plannedAmount",
    newValue: String(row.plannedAmount),
  });
  triggerAlertEvaluation(row.year ?? undefined);
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
  const [oldRow] = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.id, params.data.id));
  const [row] = await db.update(monthlyPlansTable).set(parsed.data).where(eq(monthlyPlansTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Monthly plan not found" });
    return;
  }
  if (oldRow && oldRow.plannedAmount !== row.plannedAmount) {
    await writeAuditLog({
      action: "update",
      entityType: "monthly_plan",
      entityId: row.id,
      field: "plannedAmount",
      oldValue: String(oldRow.plannedAmount),
      newValue: String(row.plannedAmount),
    });
  }
  triggerAlertEvaluation(row.year ?? undefined);
  res.json(UpdateMonthlyPlanResponse.parse(row));
}));

router.put("/budget-lines/:id/plans", asyncHandler(async (req, res): Promise<void> => {
  const params = UpsertMonthlyPlanByLineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpsertMonthlyPlanByLineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { month, year, plannedAmount } = parsed.data;
  const budgetLineId = params.data.id;

  const [existing] = await db.select().from(monthlyPlansTable).where(
    and(
      eq(monthlyPlansTable.budgetLineId, budgetLineId),
      eq(monthlyPlansTable.month, month),
      eq(monthlyPlansTable.year, year),
    ),
  );

  let row;
  if (existing) {
    [row] = await db.update(monthlyPlansTable)
      .set({ plannedAmount })
      .where(eq(monthlyPlansTable.id, existing.id))
      .returning();
    if (existing.plannedAmount !== plannedAmount) {
      await writeAuditLog({
        action: "update",
        entityType: "monthly_plan",
        entityId: row.id,
        field: "plannedAmount",
        oldValue: String(existing.plannedAmount),
        newValue: String(plannedAmount),
      });
    }
  } else {
    [row] = await db.insert(monthlyPlansTable)
      .values({ budgetLineId, month, year, plannedAmount })
      .returning();
    await writeAuditLog({
      action: "create",
      entityType: "monthly_plan",
      entityId: row.id,
      field: "plannedAmount",
      newValue: String(plannedAmount),
    });
  }
  triggerAlertEvaluation(row.year ?? undefined);
  res.json(UpsertMonthlyPlanByLineResponse.parse(row));
}));

export default router;
