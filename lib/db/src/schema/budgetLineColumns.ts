import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";

export const budgetLineColumnsTable = pgTable("budget_line_columns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull().default("text"),
  sortOrder: integer("sort_order").notNull().default(0),
  sortable: boolean("sortable").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBudgetLineColumnSchema = makeInsertSchema(budgetLineColumnsTable);
export type InsertBudgetLineColumn = z.infer<typeof insertBudgetLineColumnSchema>;
export type BudgetLineColumn = typeof budgetLineColumnsTable.$inferSelect;
