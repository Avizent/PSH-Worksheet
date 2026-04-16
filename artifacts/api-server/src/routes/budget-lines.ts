import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, budgetLinesTable } from "@workspace/db";
import { ListBudgetLineCategoriesResponse } from "@workspace/api-zod";
import {
  CreateBudgetLineBody,
  UpdateBudgetLineBody,
  GetBudgetLineParams,
  UpdateBudgetLineParams,
  DeleteBudgetLineParams,
  ListBudgetLinesResponse,
  GetBudgetLineResponse,
  UpdateBudgetLineResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { writeAuditLog, writeAuditDiff } from "../middleware/auditLog";

const router: IRouter = Router();

router.get("/budget-lines", asyncHandler(async (req, res): Promise<void> => {
  const { category, costStatus } = req.query;
  const conditions = [];
  if (typeof category === "string" && category) {
    conditions.push(eq(budgetLinesTable.category, category));
  }
  if (typeof costStatus === "string" && costStatus) {
    conditions.push(eq(budgetLinesTable.costStatus, costStatus));
  }
  const query = db.select().from(budgetLinesTable).orderBy(budgetLinesTable.category, budgetLinesTable.lineItem);
  const rows = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;
  res.json(ListBudgetLinesResponse.parse(rows));
}));

router.post("/budget-lines", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateBudgetLineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(budgetLinesTable).values(parsed.data).returning();
  await writeAuditLog({
    action: "create",
    entityType: "budget_line",
    entityId: row.id,
    field: "lineItem",
    newValue: row.lineItem,
  });
  res.status(201).json(GetBudgetLineResponse.parse(row));
}));

router.get("/budget-lines/categories", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ category: budgetLinesTable.category })
    .from(budgetLinesTable)
    .orderBy(budgetLinesTable.category);
  const list = rows.map((r) => r.category).filter((c): c is string => !!c);
  res.json(ListBudgetLineCategoriesResponse.parse(list));
}));

router.get("/budget-lines/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = GetBudgetLineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Budget line not found" });
    return;
  }
  res.json(GetBudgetLineResponse.parse(row));
}));

router.patch("/budget-lines/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateBudgetLineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBudgetLineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  // Normalize empty-string owner to null so users can clear the owner field
  if (typeof updateData.owner === "string" && updateData.owner.trim() === "") {
    updateData.owner = null;
  }
  const [oldRow] = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.id, params.data.id));
  const [row] = await db.update(budgetLinesTable).set(updateData).where(eq(budgetLinesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Budget line not found" });
    return;
  }
  if (oldRow) {
    await writeAuditDiff("update", "budget_line", row.id, oldRow, row,
      ["category", "subcategory", "lineItem", "owner", "region", "costStatus", "projectionPct"]);
  }
  res.json(UpdateBudgetLineResponse.parse(row));
}));

router.delete("/budget-lines/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = DeleteBudgetLineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(budgetLinesTable).where(eq(budgetLinesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Budget line not found" });
    return;
  }
  await writeAuditLog({
    action: "delete",
    entityType: "budget_line",
    entityId: row.id,
    field: "lineItem",
    oldValue: row.lineItem,
  });
  res.sendStatus(204);
}));

export default router;
