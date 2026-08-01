import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";
import { csvImportsTable } from "./csvImports";
import { budgetLinesTable } from "./budgetLines";

export const csvImportRowsTable = pgTable("csv_import_rows", {
  id: serial("id").primaryKey(),
  importId: integer("import_id").notNull().references(() => csvImportsTable.id, { onDelete: "cascade" }),
  rowIndex: integer("row_index").notNull(),
  rawCategory: text("raw_category"),
  rawLineItem: text("raw_line_item"),
  rawMonth: integer("raw_month"),
  rawYear: integer("raw_year"),
  rawAmount: numeric("raw_amount", { precision: 14, scale: 2, mode: "number" }),
  rawInvoiceRef: text("raw_invoice_ref"),
  status: text("status").notNull().default("unmatched"),
  // ON DELETE SET NULL, matching events and alerts. This was the only FK to
  // budget_lines left at NO ACTION, so deleting a line an import row referred
  // to raised a raw foreign-key error from Postgres mid-request instead of
  // simply unlinking the row.
  budgetLineId: integer("budget_line_id").references(() => budgetLinesTable.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
  rowHash: text("row_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCsvImportRowSchema = makeInsertSchema(csvImportRowsTable);
export type InsertCsvImportRow = z.infer<typeof insertCsvImportRowSchema>;
export type CsvImportRow = typeof csvImportRowsTable.$inferSelect;
