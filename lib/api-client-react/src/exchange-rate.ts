import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface ExchangeRateRow {
  id: number;
  rate: number;
  source: string;
  note: string | null;
  createdAt: string;
}

export interface ExchangeRateResponse {
  active: ExchangeRateRow | null;
  history: ExchangeRateRow[];
}

export interface SetExchangeRateBody {
  rate: number;
  source?: "manual" | "lookup";
  note?: string | null;
}

export interface LookupRateResponse {
  rate: number;
  date: string | null;
}

export const getExchangeRateQueryKey = () => ["exchange-rate"] as const;

/**
 * `enabled` lets the caller hold the request until the user's session header
 * is in place — /api is gated, so firing this on cold boot just yields a 401.
 */
export function useExchangeRate(opts: { enabled?: boolean } = {}) {
  const queryKey = getExchangeRateQueryKey();
  const options = queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<ExchangeRateResponse> =>
      customFetch<ExchangeRateResponse>("/api/exchange-rate", { signal }),
    enabled: opts.enabled ?? true,
  });
  const query = useQuery(options);
  return { ...query, queryKey };
}

export function useSetExchangeRate() {
  const queryClient = useQueryClient();
  return useMutation<{ active: ExchangeRateRow; snapshotId: string | null }, Error, SetExchangeRateBody>({
    mutationFn: async (body) =>
      customFetch<{ active: ExchangeRateRow; snapshotId: string | null }>("/api/exchange-rate", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getExchangeRateQueryKey() });
    },
  });
}

/** Fetches today's live rate for prefilling the admin field. Never auto-saves. */
export function useLookupExchangeRate() {
  return useMutation<LookupRateResponse, Error, void>({
    mutationFn: async () => customFetch<LookupRateResponse>("/api/exchange-rate/lookup"),
  });
}
