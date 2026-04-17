import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";
import { eventTasksTable } from "./eventTasks";

export const inAppAlertsTable = pgTable("in_app_alerts", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => eventTasksTable.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInAppAlertSchema = makeInsertSchema(inAppAlertsTable);
export type InsertInAppAlert = z.infer<typeof insertInAppAlertSchema>;
export type InAppAlert = typeof inAppAlertsTable.$inferSelect;
