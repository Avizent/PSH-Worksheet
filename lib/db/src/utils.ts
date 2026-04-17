import { createInsertSchema } from "drizzle-zod";
import type { AnyPgTable } from "drizzle-orm/pg-core";

type StandardKey = "id" | "createdAt" | "updatedAt";

/**
 * Creates a Drizzle insert schema with the standard auto-managed fields
 * (id, createdAt, updatedAt) omitted. Keys absent from the table are
 * skipped gracefully, so the same helper works for every schema regardless
 * of which timestamp columns it carries.
 */
export function makeInsertSchema<T extends AnyPgTable>(table: T) {
  const schema = createInsertSchema(table);
  type Shape = (typeof schema)["shape"];
  type OmitMask = { readonly [K in Extract<keyof Shape, StandardKey>]: true };
  const mask: Record<string, true> = {};
  if ("id" in schema.shape) mask.id = true;
  if ("createdAt" in schema.shape) mask.createdAt = true;
  if ("updatedAt" in schema.shape) mask.updatedAt = true;
  return schema.omit(mask as OmitMask);
}
