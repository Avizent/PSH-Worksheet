import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ownersTable } from "@workspace/db";
import {
  CreateOwnerBody,
  UpdateOwnerBody,
  UpdateOwnerParams,
  DeleteOwnerParams,
  ListOwnersResponse,
  ListOwnersResponseItem,
  UpdateOwnerResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { writeAuditLog, writeAuditDiff } from "../middleware/auditLog";

const router: IRouter = Router();

router.get("/owners", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(ownersTable).orderBy(ownersTable.name);
  res.json(ListOwnersResponse.parse(rows));
}));

router.post("/owners", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateOwnerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(ownersTable).values(parsed.data).returning();
  await writeAuditLog({
    action: "create",
    entityType: "owner",
    entityId: row.id,
    field: "name",
    newValue: row.name,
  });
  res.status(201).json(ListOwnersResponseItem.parse(row));
}));

router.patch("/owners/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateOwnerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateOwnerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [oldRow] = await db.select().from(ownersTable).where(eq(ownersTable.id, params.data.id));
  const [row] = await db.update(ownersTable).set(parsed.data).where(eq(ownersTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Owner not found" });
    return;
  }
  if (oldRow) {
    await writeAuditDiff("update", "owner", row.id, oldRow, row, ["name", "initials", "color"]);
  }
  res.json(UpdateOwnerResponse.parse(row));
}));

router.delete("/owners/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = DeleteOwnerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(ownersTable).where(eq(ownersTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Owner not found" });
    return;
  }
  await writeAuditLog({
    action: "delete",
    entityType: "owner",
    entityId: row.id,
    field: "name",
    oldValue: row.name,
  });
  res.sendStatus(204);
}));

export default router;
