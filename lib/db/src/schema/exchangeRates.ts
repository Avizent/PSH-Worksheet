import { pgTable, text, serial, numeric, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { makeInsertSchema } from "../utils";

// Append-only history of SEK-per-1-GBP rates. The newest row is the active
// rate; rows are never edited or deleted so the full history of what rate was
// in force (and why it changed) is permanently auditable.
export const exchangeRatesTable = pgTable("exchange_rates", {
  id: serial("id").primaryKey(),
  rate: numeric("rate", { precision: 12, scale: 6, mode: "number" }).notNull(),
  source: text("source").notNull().default("manual"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExchangeRateSchema = makeInsertSchema(exchangeRatesTable);
export type InsertExchangeRate = z.infer<typeof insertExchangeRateSchema>;
export type ExchangeRate = typeof exchangeRatesTable.$inferSelect;
