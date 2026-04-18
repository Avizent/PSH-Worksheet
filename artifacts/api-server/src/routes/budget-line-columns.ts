import { Router, type IRouter } from "express";
import { eq, asc, sql } from "drizzle-orm";
import { db, budgetLineColumnsTable, budgetLinesTable } from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { writeAuditLog } from "../middleware/auditLog";
import { z } from "zod";

const router: IRouter = Router();

const CreateBody = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["text", "number"]).default("text"),
});

const UpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["text", "number"]).optional(),
  sortOrder: z.number().int().optional(),
});

const ReorderBody = z.object({
  ids: z.array(z.number().int()).min(1),
});

router.get("/budget-line-columns", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(budgetLineColumnsTable)
    .orderBy(asc(budgetLineColumnsTable.sortOrder), asc(budgetLineColumnsTable.id));
  res.json(rows);
}));

router.post("/budget-line-columns", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = await db
    .select({ id: budgetLineColumnsTable.id })
    .from(budgetLineColumnsTable)
    .where(eq(budgetLineColumnsTable.name, parsed.data.name));
  if (existing.length > 0) {
    res.status(409).json({ error: "A column with that name already exists" });
    return;
  }

  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${budgetLineColumnsTable.sortOrder}), -1)` })
    .from(budgetLineColumnsTable);

  const [row] = await db
    .insert(budgetLineColumnsTable)
    .values({
      name: parsed.data.name,
      type: parsed.data.type,
      sortOrder: Number(maxOrder) + 1,
    })
    .returning();

  await writeAuditLog({
    action: "create",
    entityType: "budget_line_column",
    entityId: row.id,
    field: "name",
    newValue: row.name,
  });

  res.status(201).json(row);
}));

router.patch("/budget-line-columns/reorder", asyncHandler(async (req, res): Promise<void> => {
  const parsed = ReorderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.ids.length; i++) {
      await tx
        .update(budgetLineColumnsTable)
        .set({ sortOrder: i })
        .where(eq(budgetLineColumnsTable.id, parsed.data.ids[i]));
    }
  });

  const rows = await db
    .select()
    .from(budgetLineColumnsTable)
    .orderBy(asc(budgetLineColumnsTable.sortOrder), asc(budgetLineColumnsTable.id));
  res.json(rows);
}));

router.patch("/budget-line-columns/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(budgetLineColumnsTable).where(eq(budgetLineColumnsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Column not found" }); return; }

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const dupe = await db
      .select({ id: budgetLineColumnsTable.id })
      .from(budgetLineColumnsTable)
      .where(eq(budgetLineColumnsTable.name, parsed.data.name));
    if (dupe.length > 0) {
      res.status(409).json({ error: "A column with that name already exists" });
      return;
    }
  }

  const updates: Partial<typeof budgetLineColumnsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.type !== undefined) updates.type = parsed.data.type;
  if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;

  const [row] = await db
    .update(budgetLineColumnsTable)
    .set(updates)
    .where(eq(budgetLineColumnsTable.id, id))
    .returning();

  // If renamed, update the keys inside every budget_line.custom_fields jsonb to match
  if (parsed.data.name && parsed.data.name !== existing.name) {
    await db.execute(sql`
      UPDATE budget_lines
      SET custom_fields = (custom_fields - ${existing.name}) || jsonb_build_object(${parsed.data.name}::text, custom_fields->${existing.name})
      WHERE custom_fields ? ${existing.name}
    `);
    await writeAuditLog({
      action: "update",
      entityType: "budget_line_column",
      entityId: id,
      field: "name",
      oldValue: existing.name,
      newValue: parsed.data.name,
    });
  }

  res.json(row);
}));

router.delete("/budget-line-columns/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(budgetLineColumnsTable).where(eq(budgetLineColumnsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Column not found" }); return; }

  await db.delete(budgetLineColumnsTable).where(eq(budgetLineColumnsTable.id, id));

  // Strip the field from every budget line's custom_fields
  await db.execute(sql`
    UPDATE budget_lines
    SET custom_fields = custom_fields - ${existing.name}
    WHERE custom_fields ? ${existing.name}
  `);

  await writeAuditLog({
    action: "delete",
    entityType: "budget_line_column",
    entityId: id,
    field: "name",
    oldValue: existing.name,
  });
  res.status(204).send();
}));

export default router;
