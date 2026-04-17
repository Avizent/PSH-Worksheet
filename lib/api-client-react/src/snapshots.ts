import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult, QueryKey } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

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

export interface CreateSnapshotBody {
  label?: string;
}

export interface RestoreSnapshotResult {
  success: boolean;
  restoredFrom: string;
  preRestoreSnapshot: SnapshotMeta | null;
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

export const getListSnapshotsQueryKey = (): readonly [string] => ["/api/snapshots"] as const;

export const getCompareSnapshotsQueryKey = (a: string, b: string): readonly [string, string, string] =>
  ["/api/snapshots/compare", a, b] as const;

export function useListSnapshots(options?: {
  query?: Partial<Parameters<typeof useQuery>[0]>;
}): UseQueryResult<SnapshotMeta[]> & { queryKey: QueryKey } {
  const queryKey = getListSnapshotsQueryKey();
  const query = useQuery<SnapshotMeta[]>({
    queryKey,
    queryFn: ({ signal }) => customFetch<SnapshotMeta[]>("/api/snapshots", { signal }),
    ...options?.query,
  });
  return { ...query, queryKey };
}

export function useCreateSnapshot(options?: {
  mutation?: Partial<Parameters<typeof useMutation>[0]>;
}): UseMutationResult<SnapshotMeta, Error, CreateSnapshotBody> {
  const queryClient = useQueryClient();
  return useMutation<SnapshotMeta, Error, CreateSnapshotBody>({
    mutationFn: (body: CreateSnapshotBody) =>
      customFetch<SnapshotMeta>("/api/snapshots", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    },
    ...options?.mutation,
  });
}

export function useRestoreSnapshot(options?: {
  mutation?: Partial<Parameters<typeof useMutation>[0]>;
}): UseMutationResult<RestoreSnapshotResult, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<RestoreSnapshotResult, Error, string>({
    mutationFn: (id: string) =>
      customFetch<RestoreSnapshotResult>(`/api/snapshots/${encodeURIComponent(id)}/restore`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    },
    ...options?.mutation,
  });
}

export function useImportSnapshot(options?: {
  mutation?: Partial<Parameters<typeof useMutation>[0]>;
}): UseMutationResult<SnapshotMeta, Error, Record<string, unknown>> {
  const queryClient = useQueryClient();
  return useMutation<SnapshotMeta, Error, Record<string, unknown>>({
    mutationFn: (snapshotJson: Record<string, unknown>) =>
      customFetch<SnapshotMeta>("/api/snapshots/import", {
        method: "POST",
        body: JSON.stringify(snapshotJson),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    },
    ...options?.mutation,
  });
}

export function useDeleteSnapshot(options?: {
  mutation?: Partial<Parameters<typeof useMutation>[0]>;
}): UseMutationResult<void, Error, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) =>
      customFetch<void>(`/api/snapshots/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    },
    ...options?.mutation,
  });
}

export function usePinSnapshot(options?: {
  mutation?: Partial<Parameters<typeof useMutation>[0]>;
}): UseMutationResult<SnapshotMeta, Error, { id: string; data: { pinned: boolean } }> {
  const queryClient = useQueryClient();
  return useMutation<SnapshotMeta, Error, { id: string; data: { pinned: boolean } }>({
    mutationFn: ({ id, data }) =>
      customFetch<SnapshotMeta>(`/api/snapshots/${encodeURIComponent(id)}/pin`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    },
    ...options?.mutation,
  });
}

export function useCompareSnapshots(
  params: { a: string; b: string } | null,
  options?: {
    query?: Partial<Parameters<typeof useQuery>[0]>;
  }
): UseQueryResult<SnapshotDiff> {
  return useQuery<SnapshotDiff>({
    queryKey: params
      ? getCompareSnapshotsQueryKey(params.a, params.b)
      : ["/api/snapshots/compare", "", ""],
    queryFn: ({ signal }) =>
      customFetch<SnapshotDiff>(
        `/api/snapshots/compare?a=${encodeURIComponent(params!.a)}&b=${encodeURIComponent(params!.b)}`,
        { signal }
      ),
    enabled: !!params?.a && !!params?.b,
    ...options?.query,
  });
}

export function useRenameSnapshot(options?: {
  mutation?: Partial<Parameters<typeof useMutation>[0]>;
}): UseMutationResult<SnapshotMeta, Error, { id: string; label: string }> {
  const queryClient = useQueryClient();
  return useMutation<SnapshotMeta, Error, { id: string; label: string }>({
    mutationFn: ({ id, label }) =>
      customFetch<SnapshotMeta>(`/api/snapshots/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ label }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    },
    ...options?.mutation,
  });
}
