import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// These types mirror the actual /api/snapshots responses in
// artifacts/api-server/src/routes/snapshots.ts. Keep them in step with that
// file - the screen reads every field below.

export interface SnapshotMeta {
  id: string;
  filename: string;
  label: string;
  createdAt: string;
  totalBudget: number;
  totalSpent: number;
  lineCount: number;
  pinned: boolean;
}

export interface RestoreSnapshotResult {
  success: boolean;
  restoredFrom: string;
  preRestoreSnapshot: SnapshotMeta | null;
}

export interface CreateSnapshotBody {
  label?: string;
}

export interface SnapshotDiffChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface SnapshotDiffLine {
  status: "added" | "removed" | "changed" | "unchanged";
  lineItem: string;
  category: string;
  subcategory: string | null;
  totalBudgetA: number | null;
  totalBudgetB: number | null;
  changes: SnapshotDiffChange[];
}

export interface SnapshotDiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export interface SnapshotDiff {
  snapshotA: SnapshotMeta;
  snapshotB: SnapshotMeta;
  lines: SnapshotDiffLine[];
  summary: SnapshotDiffSummary;
}

export const getListSnapshotsQueryKey = () => ["snapshots"] as const;
export const getCompareSnapshotsQueryKey = (a: string, b: string) =>
  ["snapshots", "compare", a, b] as const;

// --- QUERIES ---

export function useListSnapshots() {
  const queryKey = getListSnapshotsQueryKey();
  const options = queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<SnapshotMeta[]> =>
      customFetch<SnapshotMeta[]>("/api/snapshots", { signal }),
  });
  const query = useQuery(options);
  return { ...query, queryKey };
}

/** Server expects ?a=<before>&b=<after>. */
export function useCompareSnapshots(a: string, b: string) {
  const queryKey = getCompareSnapshotsQueryKey(a, b);
  const options = queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<SnapshotDiff> =>
      customFetch<SnapshotDiff>(
        `/api/snapshots/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
        { signal },
      ),
    enabled: Boolean(a && b),
  });
  const query = useQuery(options);
  return { ...query, queryKey };
}

// --- MUTATIONS ---

function useInvalidateSnapshots() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
}

export function useCreateSnapshot() {
  const invalidate = useInvalidateSnapshots();
  return useMutation<SnapshotMeta, Error, CreateSnapshotBody>({
    mutationFn: async (body): Promise<SnapshotMeta> =>
      customFetch<SnapshotMeta>("/api/snapshots", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => invalidate(),
  });
}

export function useRestoreSnapshot() {
  const invalidate = useInvalidateSnapshots();
  return useMutation<RestoreSnapshotResult, Error, string>({
    mutationFn: async (id): Promise<RestoreSnapshotResult> =>
      customFetch<RestoreSnapshotResult>(
        `/api/snapshots/${encodeURIComponent(id)}/restore`,
        { method: "POST" },
      ),
    onSuccess: () => invalidate(),
  });
}

export function useImportSnapshot() {
  const invalidate = useInvalidateSnapshots();
  return useMutation<SnapshotMeta, Error, Record<string, unknown>>({
    mutationFn: async (snapshotJson): Promise<SnapshotMeta> =>
      customFetch<SnapshotMeta>("/api/snapshots/import", {
        method: "POST",
        body: JSON.stringify(snapshotJson),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => invalidate(),
  });
}

/** Server responds 204 No Content. */
export function useDeleteSnapshot() {
  const invalidate = useInvalidateSnapshots();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }): Promise<void> => {
      await customFetch<void>(`/api/snapshots/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => invalidate(),
  });
}

/** PATCH /api/snapshots/:id/pin */
export function usePinSnapshot() {
  const invalidate = useInvalidateSnapshots();
  return useMutation<SnapshotMeta, Error, { id: string; data: { pinned: boolean } }>({
    mutationFn: async ({ id, data }): Promise<SnapshotMeta> =>
      customFetch<SnapshotMeta>(`/api/snapshots/${encodeURIComponent(id)}/pin`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => invalidate(),
  });
}

/** PATCH /api/snapshots/:id with a new label. */
export function useRenameSnapshot() {
  const invalidate = useInvalidateSnapshots();
  return useMutation<SnapshotMeta, Error, { id: string; label: string }>({
    mutationFn: async ({ id, label }): Promise<SnapshotMeta> =>
      customFetch<SnapshotMeta>(`/api/snapshots/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ label }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => invalidate(),
  });
}
