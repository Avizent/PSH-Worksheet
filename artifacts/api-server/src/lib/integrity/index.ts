/**
 * Runs the full integrity check suite defined in
 * audit/integrity-checks-spec.md and assembles the report.
 *
 * Read-only throughout. No check may write, delete, or modify data; findings
 * describe remediation for a human to review and trigger separately.
 */
import { runDataHealthChecks } from "./dataHealth";
import { runSpreadsheetChecks } from "./spreadsheet";
import { runCalculationChecks } from "./calculations";
import type { CheckResult, IntegrityReport, Severity } from "./types";

export type { CheckResult, IntegrityReport, CheckFinding, Severity } from "./types";

export async function runIntegrityChecks(year: number): Promise<IntegrityReport> {
  const startedAt = new Date();

  // Sequential rather than parallel: these are diagnostic, not latency
  // sensitive, and running them one at a time keeps the load predictable
  // against a database that is also serving the app.
  const results: CheckResult[] = [
    ...(await runDataHealthChecks(year)),
    ...(await runSpreadsheetChecks(year)),
    ...(await runCalculationChecks(year)),
  ];

  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  let checksErrored = 0;
  for (const result of results) {
    if (!result.ok) checksErrored++;
    for (const finding of result.findings) counts[finding.severity]++;
  }

  const finishedAt = new Date();
  return {
    year,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    results,
    summary: {
      checksRun: results.length,
      checksErrored,
      critical: counts.critical,
      warning: counts.warning,
      info: counts.info,
      clean: checksErrored === 0 && counts.critical === 0 && counts.warning === 0 && counts.info === 0,
    },
  };
}
