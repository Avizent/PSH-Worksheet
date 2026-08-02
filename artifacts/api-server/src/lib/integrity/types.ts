/**
 * Shared contract for the integrity checks. The definitive specification of
 * what each check does lives in audit/integrity-checks-spec.md — read that
 * before adding or changing a check.
 *
 * Every check is read-only. A check may never write, delete, or modify data:
 * where it finds a fixable condition it describes the remediation for a human
 * to review and trigger separately.
 */

export type Severity = "critical" | "warning" | "info";

export type CheckCategory = "data-health" | "spreadsheet" | "calculation";

/** One affected row/entity, with enough detail to find it in the app. */
export interface AffectedEntity {
  /** e.g. "budget_line", "monthly_plan" */
  entityType: string;
  entityId?: number | null;
  /** Human-readable location, e.g. "Ads | PR" or "Ads | PR — 2026-03". */
  label: string;
  /** Free-form supporting figures, rendered as "key: value" in the UI. */
  detail?: Record<string, string | number | null>;
}

export interface CheckFinding {
  /** Spec ID, e.g. "DH-1". */
  id: string;
  category: CheckCategory;
  title: string;
  severity: Severity;
  /** What was found, in plain language. */
  description: string;
  /** What a human should do about it. Null when no action is needed. */
  remediation: string | null;
  affected: AffectedEntity[];
  /** Total affected count, which may exceed affected.length when truncated. */
  affectedCount: number;
}

export interface CheckResult {
  id: string;
  category: CheckCategory;
  title: string;
  /** False when the check itself could not run (not the same as finding a problem). */
  ok: boolean;
  /** Present when ok is false. */
  error?: string;
  findings: CheckFinding[];
  durationMs: number;
}

export interface IntegrityReport {
  year: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: CheckResult[];
  summary: {
    checksRun: number;
    checksErrored: number;
    critical: number;
    warning: number;
    info: number;
    /** True when nothing at any severity was found and every check ran. */
    clean: boolean;
  };
}

/** Cap on rows returned per finding, to keep a bad state from producing a huge payload. */
export const MAX_AFFECTED_PER_FINDING = 100;

/**
 * Normalisation used to decide whether two names refer to the same thing.
 *
 * `strict` (case + whitespace) is safe to merge on automatically. `loose`
 * additionally drops punctuation and is deliberately only used to *flag*
 * candidates for review — collapsing punctuation can bucket genuinely
 * different lines together, which is not a call a check should make.
 */
export function normaliseStrict(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normaliseLoose(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}
