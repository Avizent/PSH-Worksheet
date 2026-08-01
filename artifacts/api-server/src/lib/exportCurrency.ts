import { desc } from "drizzle-orm";
import { db, exchangeRatesTable } from "@workspace/db";

export type ExportCurrency = "SEK" | "GBP";

export interface CurrencyContext {
  currency: ExportCurrency;
  /** SEK per 1 GBP; null when displaying SEK or no rate configured. */
  rate: number | null;
  /** Converts a stored (SEK) amount into the requested display currency. */
  convert: (sekValue: number | null | undefined) => number;
  /** Excel number-format string for the requested currency. */
  numFmt: string;
  /** Human-readable amount, for PDF text. */
  format: (sekValue: number | null | undefined) => string;
  /** Abbreviated amount (M/k tiers), matching the existing PDF/report style. */
  formatCompact: (sekValue: number | null | undefined) => string;
  /** Line to stamp on exports so readers know what they're looking at, or null for SEK. */
  conversionNote: string | null;
}

/**
 * Builds the currency context for an export request. Amounts are always stored
 * in SEK; `?currency=GBP` converts for presentation only. If GBP is requested
 * but no rate has been configured, we fall back to SEK rather than inventing
 * a conversion.
 */
export async function resolveExportCurrency(raw: unknown): Promise<CurrencyContext> {
  const requested: ExportCurrency = String(raw).toUpperCase() === "GBP" ? "GBP" : "SEK";

  let rate: number | null = null;
  if (requested === "GBP") {
    const [row] = await db
      .select()
      .from(exchangeRatesTable)
      .orderBy(desc(exchangeRatesTable.createdAt), desc(exchangeRatesTable.id))
      .limit(1);
    rate = row ? row.rate : null;
  }

  const useGbp = requested === "GBP" && rate !== null && rate > 0;

  const convert = (sekValue: number | null | undefined): number => {
    const n = typeof sekValue === "number" && Number.isFinite(sekValue) ? sekValue : 0;
    return useGbp ? n / (rate as number) : n;
  };

  return {
    currency: useGbp ? "GBP" : "SEK",
    rate: useGbp ? rate : null,
    convert,
    numFmt: useGbp ? '£#,##0' : '#,##0 "kr"',
    format: (sekValue) => {
      const v = convert(sekValue);
      return useGbp
        ? `£${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
        : `${v.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} kr`;
    },
    formatCompact: (sekValue) => {
      const v = convert(sekValue);
      const abs = Math.abs(v);
      const sign = v < 0 ? "-" : "";
      const symbol = useGbp ? "£" : "";
      const suffix = useGbp ? "" : " kr";
      if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(2)}M${suffix}`;
      if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}k${suffix}`;
      return `${sign}${symbol}${abs.toFixed(0)}${suffix}`;
    },
    conversionNote: useGbp ? `Converted from SEK at 1 GBP = ${rate} SEK` : null,
  };
}
