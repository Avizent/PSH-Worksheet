import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";
import { budgetLinesTable } from "./budgetLines";

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  month: integer("month"),
  year: integer("year"),
  budgetLineId: integer("budget_line_id").references(() => budgetLinesTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAlertSchema = makeInsertSchema(alertsTable);
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
