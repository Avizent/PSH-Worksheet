import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";
import { eventTasksTable } from "./eventTasks";
import { alertsTable } from "./alerts";

export const taskRemindersTable = pgTable("task_reminders", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => eventTasksTable.id, { onDelete: "cascade" }),
  daysBefore: integer("days_before").notNull(),
  label: text("label"),
  firedAt: timestamp("fired_at", { withTimezone: true }),
  alertId: integer("alert_id").references(() => alertsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskReminderSchema = makeInsertSchema(taskRemindersTable);
export type InsertTaskReminder = z.infer<typeof insertTaskReminderSchema>;
export type TaskReminder = typeof taskRemindersTable.$inferSelect;
