import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, monthlyActualsTable } from "@workspace/db";
import {
  CreateMonthlyActualBody,
  UpdateMonthlyActualBody,
  UpdateMonthlyActualParams,
  ListMonthlyActualsQueryParams,
  ListMonthlyActualsResponse,
  ListMonthlyActualsResponseItem,
  UpdateMonthlyActualResponse,
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
  res.json(UpdateMonthlyActualResponse.parse(row));
}));

export default router;
