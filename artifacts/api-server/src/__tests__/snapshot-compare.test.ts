import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import app from "../app";

const SNAPSHOTS_DIR = path.resolve(process.cwd(), "snapshots");
const TEST_IDS: string[] = [];

function writeTestSnapshot(id: string, body: object): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${id}.json`), JSON.stringify(body, null, 2), "utf-8");
  TEST_IDS.push(id);
}

function makeSnapshot(label: string, lines: object[]): object {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    label,
    budgetLines: lines,
    owners: [],
    categories: [],
  };
}

function makeLine(
  category: string,
  lineItem: string,
  plans: { month: number; year: number; plannedAmount: number }[] = [],
  actuals: { month: number; year: number; actualAmount: number }[] = [],
): object {
  return {
    id: 1,
    category,
    subcategory: null,
    lineItem,
    owner: null,
    region: null,
    channel: null,
    costStatus: "committed",
    projectionPct: 100,
    boardApprovedAmount: null,
    plans: plans.map((p) => ({ ...p, boardAmount: null })),
    actuals: actuals.map((a) => ({ ...a, invoiceRef: null })),
  };
}

afterAll(async () => {
  for (const id of TEST_IDS) {
    const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  const { pool } = await import("@workspace/db");
  await pool.end();
});

describe("GET /api/snapshots/compare — error cases", () => {
  it("returns 400 when both a and b params are missing", async () => {
    const res = await request(app).get("/api/snapshots/compare");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 when only param a is provided", async () => {
    const res = await request(app).get("/api/snapshots/compare?a=some-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 when only param b is provided", async () => {
    const res = await request(app).get("/api/snapshots/compare?b=some-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 for an invalid snapshot ID containing path traversal in a", async () => {
    const res = await request(app).get("/api/snapshots/compare?a=../../etc/passwd&b=valid-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 400 for an invalid snapshot ID containing path traversal in b", async () => {
    writeTestSnapshot("valid-snap-for-traversal-test", makeSnapshot("valid", []));
    const res = await request(app).get(
      "/api/snapshots/compare?a=valid-snap-for-traversal-test&b=../../etc/passwd",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 404 when snapshot A does not exist", async () => {
    writeTestSnapshot("exists-for-404-test", makeSnapshot("exists", []));
    const res = await request(app).get(
      "/api/snapshots/compare?a=does-not-exist-snap-a&b=exists-for-404-test",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/snapshot a not found/i);
  });

  it("returns 404 when snapshot B does not exist", async () => {
    writeTestSnapshot("exists-for-404b-test", makeSnapshot("exists", []));
    const res = await request(app).get(
      "/api/snapshots/compare?a=exists-for-404b-test&b=does-not-exist-snap-b",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/snapshot b not found/i);
  });
});

describe("GET /api/snapshots/compare — diff logic", () => {
  it("returns all-unchanged when both snapshots are identical", async () => {
    const line = makeLine("Marketing", "Ad Spend", [{ month: 1, year: 2026, plannedAmount: 1000 }]);
    const snap = makeSnapshot("baseline", [line]);
    writeTestSnapshot("compare-identical-a", snap);
    writeTestSnapshot("compare-identical-b", snap);

    const res = await request(app).get(
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
    const existing = makeLine("Marketing", "Ad Spend");
    const newLine = makeLine("Engineering", "Contractors");
    writeTestSnapshot("compare-added-a", makeSnapshot("before", [existing]));
    writeTestSnapshot("compare-added-b", makeSnapshot("after", [existing, newLine]));

    const res = await request(app).get(
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
    const remaining = makeLine("Marketing", "Ad Spend");
    const removed = makeLine("Engineering", "Contractors");
    writeTestSnapshot("compare-removed-a", makeSnapshot("before", [remaining, removed]));
    writeTestSnapshot("compare-removed-b", makeSnapshot("after", [remaining]));

    const res = await request(app).get(
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
    const lineA = makeLine("Marketing", "Ad Spend", [{ month: 3, year: 2026, plannedAmount: 5000 }]);
    const lineB = makeLine("Marketing", "Ad Spend", [{ month: 3, year: 2026, plannedAmount: 7500 }]);
    writeTestSnapshot("compare-plan-a", makeSnapshot("before", [lineA]));
    writeTestSnapshot("compare-plan-b", makeSnapshot("after", [lineB]));

    const res = await request(app).get(
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
    const lineA = makeLine(
      "Marketing",
      "Ad Spend",
      [],
      [{ month: 2, year: 2026, actualAmount: 2000 }],
    );
    const lineB = makeLine(
      "Marketing",
      "Ad Spend",
      [],
      [{ month: 2, year: 2026, actualAmount: 3500 }],
    );
    writeTestSnapshot("compare-actual-a", makeSnapshot("before", [lineA]));
    writeTestSnapshot("compare-actual-b", makeSnapshot("after", [lineB]));

    const res = await request(app).get(
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
    const snap = makeSnapshot("test-label", []);
    writeTestSnapshot("compare-meta-a", { ...snap, label: "snap-a-label", timestamp: "2026-01-01T00:00:00.000Z" });
    writeTestSnapshot("compare-meta-b", { ...snap, label: "snap-b-label", timestamp: "2026-06-01T00:00:00.000Z" });

    const res = await request(app).get(
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
