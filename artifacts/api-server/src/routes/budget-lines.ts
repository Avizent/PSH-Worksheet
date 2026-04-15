import { Router, type IRouter } from "express";
import { eq, and, ilike } from "drizzle-orm";
import { db, budgetLinesTable } from "@workspace/db";
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
  res.status(201).json(GetBudgetLineResponse.parse(row));
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
  const [row] = await db.update(budgetLinesTable).set(parsed.data).where(eq(budgetLinesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Budget line not found" });
    return;
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
  res.sendStatus(204);
}));

export default router;
