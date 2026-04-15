import { pgTable, text, serial, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const boardSettingsTable = pgTable("board_settings", {
  id: serial("id").primaryKey(),
  sectionKey: text("section_key").notNull().unique(),
  label: text("label").notNull(),
  visible: boolean("visible").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBoardSettingSchema = createInsertSchema(boardSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBoardSetting = z.infer<typeof insertBoardSettingSchema>;
export type BoardSetting = typeof boardSettingsTable.$inferSelect;
