import { pgTable, serial, integer, real, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";
import { budgetLinesTable } from "./budgetLines";

export const monthlyPlansTable = pgTable("monthly_plans", {
  id: serial("id").primaryKey(),
  budgetLineId: integer("budget_line_id").notNull().references(() => budgetLinesTable.id, { onDelete: "cascade" }),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  plannedAmount: real("planned_amount").notNull().default(0),
  boardAmount: real("board_amount"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  uniqLineMonthYear: uniqueIndex("monthly_plans_line_month_year_uniq").on(t.budgetLineId, t.month, t.year),
}));

export const insertMonthlyPlanSchema = makeInsertSchema(monthlyPlansTable);
export type InsertMonthlyPlan = z.infer<typeof insertMonthlyPlanSchema>;
export type MonthlyPlan = typeof monthlyPlansTable.$inferSelect;
