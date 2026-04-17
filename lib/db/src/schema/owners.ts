import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";

export const ownersTable = pgTable("owners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  color: text("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOwnerSchema = makeInsertSchema(ownersTable);
export type InsertOwner = z.infer<typeof insertOwnerSchema>;
export type Owner = typeof ownersTable.$inferSelect;
