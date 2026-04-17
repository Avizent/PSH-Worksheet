import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";

export const shareTokensTable = pgTable("share_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  label: text("label").notNull().default("Board Link"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertShareTokenSchema = makeInsertSchema(shareTokensTable).omit({ token: true });
export type InsertShareToken = z.infer<typeof insertShareTokenSchema>;
export type ShareToken = typeof shareTokensTable.$inferSelect;
