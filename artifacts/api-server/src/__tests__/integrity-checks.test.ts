import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
} from "@workspace/db";
import { runIntegrityChecks } from "../lib/integrity";
import { DATA_HEALTH_CHECK_TITLES } from "../lib/integrity/dataHealth";
import type { IntegrityReport } from "../lib/integrity";

/**
 * These tests seed deliberately broken data and assert the checks catch it.
 * A check that runs without finding a planted fault is worse than no check,
 * so each case plants exactly one problem and looks for its specific ID.
 */

const YEAR = 2099; // isolated from any seeded fixture data
const createdLineIds: number[] = [];

function findingsFor(report: IntegrityReport, id: string) {
  return report.results.flatMap((r) => r.findings).filter((f) => f.id === id);
}

async function makeLine(fields: {
  category: string;
  lineItem: string;
  owner?: string | null;
  region?: string | null;
  costStatus?: string;
}): Promise<number> {
  const [row] = await db
    .insert(budgetLinesTable)
    .values({
      category: fields.category,
      lineItem: fields.lineItem,
      owner: fields.owner ?? null,
      region: fields.region ?? null,
      costStatus: fields.costStatus ?? "Variable",
    })
    .returning();
  createdLineIds.push(row.id);
  return row.id;
}

async function setPlan(lineId: number, month: number, amount: number): Promise<void> {
  await db.insert(monthlyPlansTable).values({
    budgetLineId: lineId,
    month,
    year: YEAR,
    plannedAmount: amount,
  });
}

async function setActual(lineId: number, month: number, amount: number): Promise<void> {
  await db.insert(monthlyActualsTable).values({
    budgetLineId: lineId,
    month,
    year: YEAR,
    actualAmount: amount,
  });
}

afterAll(async () => {
  if (createdLineIds.length > 0) {
    await db.delete(monthlyPlansTable).where(inArray(monthlyPlansTable.budgetLineId, createdLineIds));
    await db.delete(monthlyActualsTable).where(inArray(monthlyActualsTable.budgetLineId, createdLineIds));
    await db.delete(budgetLinesTable).where(inArray(budgetLinesTable.id, createdLineIds));
  }
});

describe("integrity checks — the suite runs", () => {
  it("returns a result for every specified check", async () => {
    const report = await runIntegrityChecks(YEAR);
    const ids = report.results.map((r) => r.id).sort();

    // 8 data health + 5 spreadsheet + 9 calculation. SI-6 needs a file upload
    // and is deliberately not part of the one-button run.
    expect(ids).toEqual([
      "CC-1", "CC-2", "CC-3", "CC-4", "CC-5", "CC-6", "CC-7", "CC-8", "CC-9",
      "DH-1", "DH-2", "DH-3", "DH-4", "DH-5", "DH-6", "DH-7", "DH-8",
      "SI-1", "SI-2", "SI-3", "SI-4", "SI-5",
    ]);
  });

  it("reports every check as having run without error", async () => {
    const report = await runIntegrityChecks(YEAR);
    const errored = report.results.filter((r) => !r.ok);
    expect(errored.map((r) => `${r.id}: ${r.error}`)).toEqual([]);
  });

  // If the shared budget-line/totals load fails, runDataHealthChecks reports
  // every DH check as errored rather than throwing, so the spreadsheet and
  // calculation results still reach the user instead of a bare 500. That
  // fallback carries its own hardcoded id/title list, which silently goes
  // stale if a check is added or renamed and the list isn't updated — this
  // keeps the two in step.
  it("the data-health failure fallback covers exactly the checks that run", async () => {
    const report = await runIntegrityChecks(YEAR);
    const actualDhIds = report.results
      .filter((r) => r.category === "data-health")
      .map((r) => r.id)
      .sort();
    expect(actualDhIds).toEqual(DATA_HEALTH_CHECK_TITLES.map(([id]) => id).sort());
  });

  it("summary counts match the findings actually returned", async () => {
    const report = await runIntegrityChecks(YEAR);
    const all = report.results.flatMap((r) => r.findings);
    expect(report.summary.critical).toBe(all.filter((f) => f.severity === "critical").length);
    expect(report.summary.warning).toBe(all.filter((f) => f.severity === "warning").length);
    expect(report.summary.info).toBe(all.filter((f) => f.severity === "info").length);
    expect(report.summary.checksRun).toBe(report.results.length);
  });
});

describe("DH-1 — duplicate budget lines", () => {
  it("detects two lines with the same category and line item", async () => {
    const a = await makeLine({ category: "IntegrityTest", lineItem: "Duplicate Me" });
    const b = await makeLine({ category: "IntegrityTest", lineItem: "Duplicate Me" });
    await setPlan(a, 1, 1000);
    await setActual(b, 1, 400);

    const report = await runIntegrityChecks(YEAR);
    const found = findingsFor(report, "DH-1");
    const ids = found.flatMap((f) => f.affected.map((x) => x.entityId));

    expect(found.length).toBeGreaterThan(0);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(found[0].severity).toBe("critical");
  });

  it("matches regardless of case and spacing", async () => {
    const a = await makeLine({ category: "CaseTest", lineItem: "Same  Line" });
    const b = await makeLine({ category: "casetest", lineItem: "same line" });

    const report = await runIntegrityChecks(YEAR);
    const ids = findingsFor(report, "DH-1").flatMap((f) => f.affected.map((x) => x.entityId));
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });
});

describe("DH-2 — near-duplicate budget lines", () => {
  it("flags names differing only by punctuation, and does not merge them", async () => {
    const a = await makeLine({ category: "PunctTest", lineItem: "Video case study" });
    const b = await makeLine({ category: "PunctTest", lineItem: "Video - Case Study" });

    const report = await runIntegrityChecks(YEAR);
    const found = findingsFor(report, "DH-2");
    const ids = found.flatMap((f) => f.affected.map((x) => x.entityId));

    expect(ids).toContain(a);
    expect(ids).toContain(b);
    // Warning, not critical: a human decides whether these are the same line.
    expect(found.every((f) => f.severity === "warning")).toBe(true);
  });

  it("does not re-report an exact duplicate already caught by DH-1", async () => {
    const a = await makeLine({ category: "NoDoubleReport", lineItem: "Exact" });
    const b = await makeLine({ category: "NoDoubleReport", lineItem: "Exact" });

    const report = await runIntegrityChecks(YEAR);
    const dh2Ids = findingsFor(report, "DH-2").flatMap((f) => f.affected.map((x) => x.entityId));
    expect(dh2Ids).not.toContain(a);
    expect(dh2Ids).not.toContain(b);
  });
});

describe("DH-3 — budget and spend split across two lines", () => {
  it("detects one line holding only budget and another only spend", async () => {
    // Differ by punctuation, not just spacing: an exact-after-normalisation
    // match is DH-1's finding, and DH-3 deliberately skips those.
    const planOnly = await makeLine({ category: "SplitTest", lineItem: "Event Dinner" });
    const actualOnly = await makeLine({ category: "SplitTest", lineItem: "Event-Dinner" });
    await setPlan(planOnly, 3, 15000);
    await setActual(actualOnly, 3, 33000);

    const report = await runIntegrityChecks(YEAR);
    const ids = findingsFor(report, "DH-3").flatMap((f) => f.affected.map((x) => x.entityId));
    expect(ids).toContain(planOnly);
    expect(ids).toContain(actualOnly);
  });
});

describe("DH-7 — unrecognised cost status", () => {
  it("flags a blank cost status", async () => {
    const id = await makeLine({ category: "StatusTest", lineItem: "Blank Status", costStatus: "" });

    const report = await runIntegrityChecks(YEAR);
    const ids = findingsFor(report, "DH-7").flatMap((f) => f.affected.map((x) => x.entityId));
    expect(ids).toContain(id);
  });

  it("does not flag a valid cost status", async () => {
    const id = await makeLine({
      category: "StatusTest",
      lineItem: "Good Status",
      costStatus: "Fixed Cost",
    });

    const report = await runIntegrityChecks(YEAR);
    const ids = findingsFor(report, "DH-7").flatMap((f) => f.affected.map((x) => x.entityId));
    expect(ids).not.toContain(id);
  });
});

describe("CC-1 — over-budget detection", () => {
  it("flags a line that has spent more than its budget", async () => {
    const id = await makeLine({ category: "OverspendTest", lineItem: "Over Budget Line" });
    await setPlan(id, 5, 1000);
    await setActual(id, 5, 2500);

    const report = await runIntegrityChecks(YEAR);
    const overspend = findingsFor(report, "CC-1").filter((f) => f.title.includes("over budget"));
    const ids = overspend.flatMap((f) => f.affected.map((x) => x.entityId));
    expect(ids).toContain(id);
  });
});

describe("CC-4 — money column precision", () => {
  it("confirms monetary columns are exact decimals", async () => {
    const report = await runIntegrityChecks(YEAR);
    // This is a regression guard: numeric was restored deliberately, so any
    // finding here means a migration reintroduced floating point.
    expect(findingsFor(report, "CC-4")).toEqual([]);
  });
});

describe("SI-3 — month coverage", () => {
  it("flags a line with some but not all twelve months", async () => {
    const id = await makeLine({ category: "MonthTest", lineItem: "Partial Months" });
    await setPlan(id, 1, 100);
    await setPlan(id, 2, 100);

    const report = await runIntegrityChecks(YEAR);
    const ids = findingsFor(report, "SI-3").flatMap((f) => f.affected.map((x) => x.entityId));
    expect(ids).toContain(id);
  });

  it("does not flag a line with all twelve months", async () => {
    const id = await makeLine({ category: "MonthTest", lineItem: "Full Months" });
    for (let m = 1; m <= 12; m++) await setPlan(id, m, 100);

    const report = await runIntegrityChecks(YEAR);
    const ids = findingsFor(report, "SI-3").flatMap((f) => f.affected.map((x) => x.entityId));
    expect(ids).not.toContain(id);
  });
});

describe("checks are read-only", () => {
  it("leaves the data unchanged", async () => {
    const id = await makeLine({ category: "ReadOnlyTest", lineItem: "Untouched" });
    await setPlan(id, 1, 4321);
    await setActual(id, 1, 1234);

    const before = await db.select().from(budgetLinesTable);
    const beforePlans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, YEAR));
    const beforeActuals = await db
      .select()
      .from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.year, YEAR));

    await runIntegrityChecks(YEAR);

    const after = await db.select().from(budgetLinesTable);
    const afterPlans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, YEAR));
    const afterActuals = await db
      .select()
      .from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.year, YEAR));

    expect(after.length).toBe(before.length);
    expect(afterPlans.length).toBe(beforePlans.length);
    expect(afterActuals.length).toBe(beforeActuals.length);
    expect(afterPlans.reduce((s, p) => s + Number(p.plannedAmount), 0)).toBe(
      beforePlans.reduce((s, p) => s + Number(p.plannedAmount), 0),
    );
    expect(afterActuals.reduce((s, a) => s + Number(a.actualAmount), 0)).toBe(
      beforeActuals.reduce((s, a) => s + Number(a.actualAmount), 0),
    );
  });
});
