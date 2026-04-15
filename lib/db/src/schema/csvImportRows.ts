import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
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
  rawAmount: real("raw_amount"),
  rawInvoiceRef: text("raw_invoice_ref"),
  status: text("status").notNull().default("unmatched"),
  budgetLineId: integer("budget_line_id").references(() => budgetLinesTable.id),
  errorMessage: text("error_message"),
  rowHash: text("row_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCsvImportRowSchema = createInsertSchema(csvImportRowsTable).omit({ id: true, createdAt: true });
export type InsertCsvImportRow = z.infer<typeof insertCsvImportRowSchema>;
export type CsvImportRow = typeof csvImportRowsTable.$inferSelect;
