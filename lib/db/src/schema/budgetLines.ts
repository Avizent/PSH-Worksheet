import { pgTable, text, serial, timestamp, real } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";

export const budgetLinesTable = pgTable("budget_lines", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  lineItem: text("line_item").notNull(),
  owner: text("owner"),
  region: text("region"),
  channel: text("channel"),
  costStatus: text("cost_status").notNull().default("Variable"),
  projectionPct: real("projection_pct").notNull().default(0),
  boardApprovedAmount: real("board_approved_amount"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBudgetLineSchema = makeInsertSchema(budgetLinesTable);
export type InsertBudgetLine = z.infer<typeof insertBudgetLineSchema>;
export type BudgetLine = typeof budgetLinesTable.$inferSelect;
