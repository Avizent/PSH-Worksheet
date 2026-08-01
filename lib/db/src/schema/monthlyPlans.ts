import { pgTable, serial, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";
import { budgetLinesTable } from "./budgetLines";

export const monthlyPlansTable = pgTable("monthly_plans", {
  id: serial("id").primaryKey(),
  budgetLineId: integer("budget_line_id").notNull().references(() => budgetLinesTable.id, { onDelete: "cascade" }),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  plannedAmount: numeric("planned_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  boardAmount: numeric("board_amount", { precision: 14, scale: 2, mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  uniqLineMonthYear: uniqueIndex("monthly_plans_line_month_year_uniq").on(t.budgetLineId, t.month, t.year),
}));

export const insertMonthlyPlanSchema = makeInsertSchema(monthlyPlansTable);
export type InsertMonthlyPlan = z.infer<typeof insertMonthlyPlanSchema>;
export type MonthlyPlan = typeof monthlyPlansTable.$inferSelect;
