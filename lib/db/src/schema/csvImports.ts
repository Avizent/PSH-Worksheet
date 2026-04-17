import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";

export const csvImportsTable = pgTable("csv_imports", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("pending"),
  totalRows: integer("total_rows").notNull().default(0),
  matchedRows: integer("matched_rows").notNull().default(0),
  unmatchedRows: integer("unmatched_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertCsvImportSchema = makeInsertSchema(csvImportsTable);
export type InsertCsvImport = z.infer<typeof insertCsvImportSchema>;
export type CsvImport = typeof csvImportsTable.$inferSelect;
