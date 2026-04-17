import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";
import { budgetLinesTable } from "./budgetLines";

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  eventDate: timestamp("event_date", { withTimezone: true }),
  status: text("status").notNull().default("Planned"),
  estimatedCost: real("estimated_cost"),
  budgetLineId: integer("budget_line_id").references(() => budgetLinesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEventSchema = makeInsertSchema(eventsTable);
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type MarketingEvent = typeof eventsTable.$inferSelect;
