import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";
import { eventsTable } from "./events";

export const eventTasksTable = pgTable("event_tasks", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  assignee: text("assignee"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEventTaskSchema = makeInsertSchema(eventTasksTable);
export type InsertEventTask = z.infer<typeof insertEventTaskSchema>;
export type EventTask = typeof eventTasksTable.$inferSelect;
