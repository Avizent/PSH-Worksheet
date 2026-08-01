import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { req, loginForTests, cleanupTestUser } from "./helpers/testClient";

const SNAPSHOTS_DIR = path.resolve(process.cwd(), "snapshots");
const TEST_IDS: string[] = [];

function writeTestSnapshot(id: string, body: object): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${id}.json`), JSON.stringify(body, null, 2), "utf-8");
  TEST_IDS.push(id);
}

/**
 * Build a snapshot body in the format that readSnapshotFile() parses:
 * { id, label, createdAt, pinned, data: { budgetLines, monthlyPlans, monthlyActuals, owners, categories } }
 *
 * Plans and actuals are passed via the lines array as embedded fields, then split into flat arrays.
 */
function makeSnapshot(
  id: string,
  label: string,
  lines: {
    id: number;
    category: string;
    lineItem: string;
    plans?: { month: number; year: number; plannedAmount: number }[];
    actuals?: { month: number; year: number; actualAmount: number }[];
  }[],
): object {
  const budgetLines = lines.map((l) => ({
    id: l.id,
    category: l.category,
    subcategory: null,
    lineItem: l.lineItem,
    owner: null,
    region: null,
    channel: null,
    costStatus: "committed",
    projectionPct: 100,
    boardApprovedAmount: null,
  }));

  let planIdCounter = 1;
  const monthlyPlans = lines.flatMap((l) =>
    (l.plans ?? []).map((p) => ({
      id: planIdCounter++,
      budgetLineId: l.id,
      month: p.month,
      year: p.year,
      plannedAmount: p.plannedAmount,
      boardAmount: null,
    })),
  );

  let actualIdCounter = 1;
  const monthlyActuals = lines.flatMap((l) =>
    (l.actuals ?? []).map((a) => ({
      id: actualIdCounter++,
      budgetLineId: l.id,
      month: a.month,
      year: a.year,
      actualAmount: a.actualAmount,
      invoiceRef: null,
    })),
  );

  return {
    id,
    label,
    createdAt: "2026-01-01T00:00:00.000Z",
    pinned: false,
    data: {
      budgetLines,
      monthlyPlans,
      monthlyActuals,
      owners: [],
      categories: [],
    },
  };
}

beforeAll(async () => {
  await loginForTests();
});

afterAll(async () => {
  await cleanupTestUser();
  for (const id of TEST_IDS) {
    const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  const { pool } = await import("@workspace/db");
  await pool.end();
});

describe("GET /api/snapshots/compare — error cases", () => {
  it("returns 400 when both a and b params are missing", async () => {
    const res = await req().get("/api/snapshots/compare");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 when only param a is provided", async () => {
    const res = await req().get("/api/snapshots/compare?a=some-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 when only param b is provided", async () => {
    const res = await req().get("/api/snapshots/compare?b=some-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 for an invalid snapshot ID containing path traversal in a", async () => {
    const res = await req().get("/api/snapshots/compare?a=../../etc/passwd&b=valid-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 400 for an invalid snapshot ID containing path traversal in b", async () => {
    writeTestSnapshot("valid-snap-for-traversal-test", makeSnapshot("valid-snap-for-traversal-test", "valid", []));
    const res = await req().get(
      "/api/snapshots/compare?a=valid-snap-for-traversal-test&b=../../etc/passwd",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 404 when snapshot A does not exist", async () => {
    writeTestSnapshot("exists-for-404-test", makeSnapshot("exists-for-404-test", "exists", []));
    const res = await req().get(
      "/api/snapshots/compare?a=does-not-exist-snap-a&b=exists-for-404-test",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/snapshot a not found/i);
  });

  it("returns 404 when snapshot B does not exist", async () => {
    writeTestSnapshot("exists-for-404b-test", makeSnapshot("exists-for-404b-test", "exists", []));
    const res = await req().get(
      "/api/snapshots/compare?a=exists-for-404b-test&b=does-not-exist-snap-b",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/snapshot b not found/i);
  });
});

describe("GET /api/snapshots/compare — diff logic", () => {
  it("returns all-unchanged when both snapshots are identical", async () => {
    const line = { id: 1, category: "Marketing", lineItem: "Ad Spend", plans: [{ month: 1, year: 2026, plannedAmount: 1000 }] };
    writeTestSnapshot("compare-identical-a", makeSnapshot("compare-identical-a", "baseline", [line]));
    writeTestSnapshot("compare-identical-b", makeSnapshot("compare-identical-b", "baseline", [line]));

    const res = await req().get(
      "/api/snapshots/compare?a=compare-identical-a&b=compare-identical-b",
    );
    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].status).toBe("unchanged");
    expect(res.body.lines[0].changes).toHaveLength(0);
    expect(res.body.summary.unchanged).toBe(1);
    expect(res.body.summary.changed).toBe(0);
    expect(res.body.summary.added).toBe(0);
    expect(res.body.summary.removed).toBe(0);
  });

  it("detects an added budget line (present in B, absent in A)", async () => {
    const existing = { id: 1, category: "Marketing", lineItem: "Ad Spend" };
    const newLine = { id: 2, category: "Engineering", lineItem: "Contractors" };
    writeTestSnapshot("compare-added-a", makeSnapshot("compare-added-a", "before", [existing]));
    writeTestSnapshot("compare-added-b", makeSnapshot("compare-added-b", "after", [existing, newLine]));

    const res = await req().get(
      "/api/snapshots/compare?a=compare-added-a&b=compare-added-b",
    );
    expect(res.status).toBe(200);

    const added = res.body.lines.find(
      (l: { lineItem: string; status: string }) => l.lineItem === "Contractors" && l.status === "added",
    );
    expect(added).toBeDefined();
    expect(res.body.summary.added).toBe(1);

    const unchanged = res.body.lines.find(
      (l: { lineItem: string; status: string }) => l.lineItem === "Ad Spend" && l.status === "unchanged",
    );
    expect(unchanged).toBeDefined();
  });

  it("detects a removed budget line (present in A, absent in B)", async () => {
    const remaining = { id: 1, category: "Marketing", lineItem: "Ad Spend" };
    const removed = { id: 2, category: "Engineering", lineItem: "Contractors" };
    writeTestSnapshot("compare-removed-a", makeSnapshot("compare-removed-a", "before", [remaining, removed]));
    writeTestSnapshot("compare-removed-b", makeSnapshot("compare-removed-b", "after", [remaining]));

    const res = await req().get(
      "/api/snapshots/compare?a=compare-removed-a&b=compare-removed-b",
    );
    expect(res.status).toBe(200);

    const removedResult = res.body.lines.find(
      (l: { lineItem: string; status: string }) => l.lineItem === "Contractors" && l.status === "removed",
    );
    expect(removedResult).toBeDefined();
    expect(res.body.summary.removed).toBe(1);
  });

  it("detects a monthly plan amount change", async () => {
    const lineA = { id: 1, category: "Marketing", lineItem: "Ad Spend", plans: [{ month: 3, year: 2026, plannedAmount: 5000 }] };
    const lineB = { id: 1, category: "Marketing", lineItem: "Ad Spend", plans: [{ month: 3, year: 2026, plannedAmount: 7500 }] };
    writeTestSnapshot("compare-plan-a", makeSnapshot("compare-plan-a", "before", [lineA]));
    writeTestSnapshot("compare-plan-b", makeSnapshot("compare-plan-b", "after", [lineB]));

    const res = await req().get(
      "/api/snapshots/compare?a=compare-plan-a&b=compare-plan-b",
    );
    expect(res.status).toBe(200);

    const changed = res.body.lines.find(
      (l: { lineItem: string; status: string }) => l.lineItem === "Ad Spend" && l.status === "changed",
    );
    expect(changed).toBeDefined();

    const planChange = changed.changes.find(
      (c: { field: string }) => c.field === "plan:2026-03",
    );
    expect(planChange).toBeDefined();
    expect(planChange.from).toBe("5000");
    expect(planChange.to).toBe("7500");
    expect(res.body.summary.changed).toBe(1);
  });

  it("detects a monthly actual amount change", async () => {
    const lineA = { id: 1, category: "Marketing", lineItem: "Ad Spend", actuals: [{ month: 2, year: 2026, actualAmount: 2000 }] };
    const lineB = { id: 1, category: "Marketing", lineItem: "Ad Spend", actuals: [{ month: 2, year: 2026, actualAmount: 3500 }] };
    writeTestSnapshot("compare-actual-a", makeSnapshot("compare-actual-a", "before", [lineA]));
    writeTestSnapshot("compare-actual-b", makeSnapshot("compare-actual-b", "after", [lineB]));

    const res = await req().get(
      "/api/snapshots/compare?a=compare-actual-a&b=compare-actual-b",
    );
    expect(res.status).toBe(200);

    const changed = res.body.lines.find(
      (l: { lineItem: string; status: string }) => l.lineItem === "Ad Spend" && l.status === "changed",
    );
    expect(changed).toBeDefined();

    const actualChange = changed.changes.find(
      (c: { field: string }) => c.field === "actual:2026-02",
    );
    expect(actualChange).toBeDefined();
    expect(actualChange.from).toBe("2000");
    expect(actualChange.to).toBe("3500");
    expect(res.body.summary.changed).toBe(1);
  });

  it("returns correct snapshotA and snapshotB metadata in response", async () => {
    writeTestSnapshot(
      "compare-meta-a",
      makeSnapshot("compare-meta-a", "snap-a-label", []),
    );
    writeTestSnapshot(
      "compare-meta-b",
      makeSnapshot("compare-meta-b", "snap-b-label", []),
    );

    const res = await req().get(
      "/api/snapshots/compare?a=compare-meta-a&b=compare-meta-b",
    );
    expect(res.status).toBe(200);
    expect(res.body.snapshotA.id).toBe("compare-meta-a");
    expect(res.body.snapshotA.label).toBe("snap-a-label");
    expect(res.body.snapshotB.id).toBe("compare-meta-b");
    expect(res.body.snapshotB.label).toBe("snap-b-label");
    expect(res.body.summary).toBeDefined();
  });
});
