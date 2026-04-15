import { pgTable, serial, integer, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { budgetLinesTable } from "./budgetLines";

export const monthlyActualsTable = pgTable("monthly_actuals", {
  id: serial("id").primaryKey(),
  budgetLineId: integer("budget_line_id").notNull().references(() => budgetLinesTable.id, { onDelete: "cascade" }),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  actualAmount: real("actual_amount").notNull().default(0),
  invoiceRef: text("invoice_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMonthlyActualSchema = createInsertSchema(monthlyActualsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMonthlyActual = z.infer<typeof insertMonthlyActualSchema>;
export type MonthlyActual = typeof monthlyActualsTable.$inferSelect;
