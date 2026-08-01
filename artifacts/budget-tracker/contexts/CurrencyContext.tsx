import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useExchangeRate } from "@workspace/api-client-react/exchange-rate";
import { useAuth } from "@/contexts/AuthContext";

export type DisplayCurrency = "SEK" | "GBP";

interface CurrencyContextValue {
  /** Currency the user is currently viewing figures in. */
  currency: DisplayCurrency;
  /** SEK per 1 GBP; null when no rate has been configured yet. */
  rate: number | null;
  /** True when GBP is selected but no rate exists, so figures fall back to SEK. */
  needsRate: boolean;
  setCurrency: (c: DisplayCurrency) => void;
  toggleCurrency: () => void;
  /** Full-precision display, e.g. "1 234 567 kr" or "£96,150". */
  format: (sekValue: number | null | undefined) => string;
  /** Abbreviated display for chart axes/labels, e.g. "1,2 M kr" or "£96k". */
  formatCompact: (sekValue: number | null | undefined) => string;
}

const STORAGE_KEY = "display-currency";

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>("SEK");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        if (val === "SEK" || val === "GBP") setCurrencyState(val);
      })
      .catch(() => {});
  }, []);

  // Hold the rate request until sign-in completes: /api is gated, so asking
  // before the session header exists returns 401 and caches an error.
  const { isAuthenticated } = useAuth();
  const { data } = useExchangeRate({ enabled: isAuthenticated });

  const rate = data?.active?.rate ?? null;
  const needsRate = currency === "GBP" && rate === null;

  const setCurrency = useCallback((c: DisplayCurrency) => {
    setCurrencyState(c);
    AsyncStorage.setItem(STORAGE_KEY, c).catch(() => {});
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrencyState((current) => {
      const next: DisplayCurrency = current === "SEK" ? "GBP" : "SEK";
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<CurrencyContextValue>(() => {
    // Values are stored in SEK. GBP is a display lens only - if no rate is
    // configured we show SEK rather than inventing a conversion.
    const useGbp = currency === "GBP" && rate !== null && rate > 0;

    const convert = (sekValue: number | null | undefined): number => {
      const n = typeof sekValue === "number" && Number.isFinite(sekValue) ? sekValue : 0;
      return useGbp ? n / (rate as number) : n;
    };

    const format = (sekValue: number | null | undefined): string => {
      const v = convert(sekValue);
      return useGbp
        ? `£${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
        : `${v.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} kr`;
    };

    const formatCompact = (sekValue: number | null | undefined): string => {
      const v = convert(sekValue);
      const abs = Math.abs(v);
      const sign = v < 0 ? "-" : "";
      const symbol = useGbp ? "£" : "";
      const suffix = useGbp ? "" : " kr";
      if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M${suffix}`;
      if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(0)}k${suffix}`;
      return `${sign}${symbol}${abs.toFixed(0)}${suffix}`;
    };

    return { currency, rate, needsRate, setCurrency, toggleCurrency, format, formatCompact };
  }, [currency, rate, needsRate, setCurrency, toggleCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within a CurrencyProvider");
  return ctx;
}
