import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ownersTable = pgTable("owners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  color: text("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOwnerSchema = createInsertSchema(ownersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOwner = z.infer<typeof insertOwnerSchema>;
export type Owner = typeof ownersTable.$inferSelect;
