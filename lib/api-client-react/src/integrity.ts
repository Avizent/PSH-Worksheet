import { useMutation } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// Mirrors the report shape in artifacts/api-server/src/lib/integrity/types.ts.
// The checks themselves are specified in audit/integrity-checks-spec.md.

export type IntegritySeverity = "critical" | "warning" | "info";
export type IntegrityCategory = "data-health" | "spreadsheet" | "calculation";

export interface IntegrityAffected {
  entityType: string;
  entityId?: number | null;
  label: string;
  detail?: Record<string, string | number | null>;
}

export interface IntegrityFinding {
  id: string;
  category: IntegrityCategory;
  title: string;
  severity: IntegritySeverity;
  description: string;
  remediation: string | null;
  affected: IntegrityAffected[];
  affectedCount: number;
}

export interface IntegrityCheckResult {
  id: string;
  category: IntegrityCategory;
  title: string;
  ok: boolean;
  error?: string;
  findings: IntegrityFinding[];
  durationMs: number;
}

export interface IntegrityReport {
  year: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: IntegrityCheckResult[];
  summary: {
    checksRun: number;
    checksErrored: number;
    critical: number;
    warning: number;
    info: number;
    clean: boolean;
  };
}

/**
 * Run on demand rather than on screen load: the suite touches every budget
 * line and is meant to be triggered by the Check Integrity button, not fired
 * automatically whenever the screen mounts.
 */
export function useRunIntegrityCheck() {
  return useMutation<IntegrityReport, Error, { year?: number } | void>({
    mutationFn: async (vars) => {
      const year = vars && "year" in vars && vars.year ? vars.year : undefined;
      const query = year ? `?year=${encodeURIComponent(String(year))}` : "";
      return customFetch<IntegrityReport>(`/api/integrity/check${query}`);
    },
  });
}
