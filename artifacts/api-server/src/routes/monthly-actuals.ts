import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, monthlyActualsTable } from "@workspace/db";
import { triggerAlertEvaluation } from "../lib/runAlertEvaluation";
import {
  CreateMonthlyActualBody,
  UpdateMonthlyActualBody,
  UpdateMonthlyActualParams,
  ListMonthlyActualsQueryParams,
  ListMonthlyActualsResponse,
  ListMonthlyActualsResponseItem,
  UpdateMonthlyActualResponse,
  UpsertMonthlyActualByLineParams,
  UpsertMonthlyActualByLineBody,
  UpsertMonthlyActualByLineResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { writeAuditLog, writeAuditDiff } from "../middleware/auditLog";

const router: IRouter = Router();

router.get("/monthly-actuals", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = ListMonthlyActualsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }
  const { budgetLineId, year } = queryParsed.data;
  const conditions = [];
  if (budgetLineId != null) {
    conditions.push(eq(monthlyActualsTable.budgetLineId, budgetLineId));
  }
  if (year != null) {
    conditions.push(eq(monthlyActualsTable.year, year));
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
  await writeAuditLog({
    action: "create",
    entityType: "monthly_actual",
    entityId: row.id,
    field: "actualAmount",
    newValue: String(row.actualAmount),
  });
  triggerAlertEvaluation(row.year ?? undefined);
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
  const [existing] = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.id, params.data.id));
  const [row] = await db.update(monthlyActualsTable).set(parsed.data).where(eq(monthlyActualsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Monthly actual not found" });
    return;
  }
  if (existing) {
    await writeAuditDiff("update", "monthly_actual", row.id, existing, row, ["actualAmount", "invoiceRef"]);
  }
  triggerAlertEvaluation(row.year ?? undefined);
  res.json(UpdateMonthlyActualResponse.parse(row));
}));

router.put("/budget-lines/:id/actuals", asyncHandler(async (req, res): Promise<void> => {
  const params = UpsertMonthlyActualByLineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpsertMonthlyActualByLineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { month, year, actualAmount, invoiceRef } = parsed.data;
  const budgetLineId = params.data.id;

  const [existing] = await db.select().from(monthlyActualsTable).where(
    and(
      eq(monthlyActualsTable.budgetLineId, budgetLineId),
      eq(monthlyActualsTable.month, month),
      eq(monthlyActualsTable.year, year),
    ),
  );

  if (existing && existing.importId != null && actualAmount === 0) {
    res.status(409).json({ error: "Cannot blank an import-linked actual; delete the import instead." });
    return;
  }

  let row;
  if (existing) {
    const setObj: { actualAmount: number; invoiceRef?: string | null } = { actualAmount };
    if (invoiceRef !== undefined) setObj.invoiceRef = invoiceRef;
    [row] = await db.update(monthlyActualsTable)
      .set(setObj)
      .where(eq(monthlyActualsTable.id, existing.id))
      .returning();
    await writeAuditDiff("update", "monthly_actual", row.id, existing, row, ["actualAmount", "invoiceRef"]);
  } else {
    [row] = await db.insert(monthlyActualsTable)
      .values({ budgetLineId, month, year, actualAmount, invoiceRef: invoiceRef ?? null })
      .returning();
    await writeAuditLog({
      action: "create",
      entityType: "monthly_actual",
      entityId: row.id,
      field: "actualAmount",
      newValue: String(actualAmount),
    });
  }
  triggerAlertEvaluation(row.year ?? undefined);
  res.json(UpsertMonthlyActualByLineResponse.parse(row));
}));

export default router;
