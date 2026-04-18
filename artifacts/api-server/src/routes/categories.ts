import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, categoriesTable, budgetLinesTable } from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { writeAuditLog } from "../middleware/auditLog";
import { z } from "zod";

const router: IRouter = Router();

const CreateCategoryBodySchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  description: z.string().nullable().optional(),
});

const UpdateCategoryBodySchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
});

router.get("/categories", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      color: categoriesTable.color,
      description: categoriesTable.description,
      createdAt: categoriesTable.createdAt,
      updatedAt: categoriesTable.updatedAt,
      lineCount: sql<number>`cast(count(${budgetLinesTable.id}) as int)`,
    })
    .from(categoriesTable)
    .leftJoin(budgetLinesTable, eq(budgetLinesTable.category, categoriesTable.name))
    .groupBy(
      categoriesTable.id,
      categoriesTable.name,
      categoriesTable.color,
      categoriesTable.description,
      categoriesTable.createdAt,
      categoriesTable.updatedAt,
    )
    .orderBy(categoriesTable.name);
  res.json(rows);
}));

router.post("/categories", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateCategoryBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(categoriesTable)
    .values({
      name: parsed.data.name,
      color: parsed.data.color,
      description: parsed.data.description ?? null,
    })
    .returning();
  await writeAuditLog({ action: "create", entityType: "category", entityId: row.id, field: "name", newValue: row.name });
  res.status(201).json(row);
}));

router.patch("/categories/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateCategoryBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Category not found" }); return; }

  const updates: Partial<typeof categoriesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.color !== undefined) updates.color = parsed.data.color;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  const [row] = await db.update(categoriesTable).set(updates).where(eq(categoriesTable.id, id)).returning();

  if (parsed.data.name && parsed.data.name !== existing.name) {
    await db
      .update(budgetLinesTable)
      .set({ category: parsed.data.name })
      .where(eq(budgetLinesTable.category, existing.name));
    await writeAuditLog({
      action: "update",
      entityType: "category",
      entityId: id,
      field: "name",
      oldValue: existing.name,
      newValue: parsed.data.name,
    });
  }

  res.json(row);
}));

router.delete("/categories/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Category not found" }); return; }

  await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
  await writeAuditLog({ action: "delete", entityType: "category", entityId: id, field: "name", oldValue: existing.name });
  res.status(204).send();
}));

export default router;
