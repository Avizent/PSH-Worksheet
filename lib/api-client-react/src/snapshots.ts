import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult, QueryKey } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface SnapshotMeta {
  id: string;
  filename: string;
  label: string;
  createdAt: string;
  pinned?: boolean;
}

export interface CreateSnapshotBody {
  label?: string;
}

export interface RestoreSnapshotResult {
  success: boolean;
  restoredFrom: string;
  preRestoreSnapshot: SnapshotMeta | null;
}

export const getListSnapshotsQueryKey = (): readonly [string] => ["/api/snapshots"] as const;

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
