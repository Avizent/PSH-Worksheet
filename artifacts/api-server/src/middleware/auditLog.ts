import { db, auditLogsTable } from "@workspace/db";

interface AuditEntry {
  action: string;
  entityType: string;
  entityId: number;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  userId?: number | null;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      field: entry.field,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      userId: entry.userId ?? null,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

export async function writeAuditDiff(
  action: string,
  entityType: string,
  entityId: number,
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  fields: string[],
  userId?: number | null,
): Promise<void> {
  for (const field of fields) {
    const oldVal = oldObj[field];
    const newVal = newObj[field];
    if (String(oldVal ?? "") !== String(newVal ?? "")) {
      await writeAuditLog({
        action,
        entityType,
        entityId,
        field,
        oldValue: oldVal != null ? String(oldVal) : null,
        newValue: newVal != null ? String(newVal) : null,
        userId,
      });
    }
  }
}
