import { pgTable, serial, text, integer, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { budgetLinesTable } from "./budgetLines";

export const forecastVersionsTable = pgTable("forecast_versions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  versionNumber: integer("version_number").notNull().default(0),
  year: integer("year").notNull().default(2026),
  isOriginal: boolean("is_original").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const forecastPlansTable = pgTable("forecast_plans", {
  id: serial("id").primaryKey(),
  versionId: integer("version_id").notNull().references(() => forecastVersionsTable.id, { onDelete: "cascade" }),
  budgetLineId: integer("budget_line_id").notNull().references(() => budgetLinesTable.id, { onDelete: "cascade" }),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  plannedAmount: real("planned_amount").notNull().default(0),
});

export const insertForecastVersionSchema = createInsertSchema(forecastVersionsTable).omit({ id: true, createdAt: true });
export type InsertForecastVersion = z.infer<typeof insertForecastVersionSchema>;
export type ForecastVersion = typeof forecastVersionsTable.$inferSelect;

export const insertForecastPlanSchema = createInsertSchema(forecastPlansTable).omit({ id: true });
export type InsertForecastPlan = z.infer<typeof insertForecastPlanSchema>;
export type ForecastPlan = typeof forecastPlansTable.$inferSelect;
