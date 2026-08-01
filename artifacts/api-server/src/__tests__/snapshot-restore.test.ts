import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { req, loginForTests, cleanupTestUser } from "./helpers/testClient";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  ownersTable,
  categoriesTable,
} from "@workspace/db";

const SNAPSHOTS_DIR = path.resolve(process.cwd(), "snapshots");
const TEST_SNAPSHOT_IDS: string[] = [];

type SavedDbState = {
  budgetLines: (typeof budgetLinesTable.$inferSelect)[];
  monthlyPlans: (typeof monthlyPlansTable.$inferSelect)[];
  monthlyActuals: (typeof monthlyActualsTable.$inferSelect)[];
  owners: (typeof ownersTable.$inferSelect)[];
  categories: (typeof categoriesTable.$inferSelect)[];
};

let savedState: SavedDbState;

function writeTestSnapshot(id: string, body: object): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
  fs.writeFileSync(
    path.join(SNAPSHOTS_DIR, `${id}.json`),
    JSON.stringify(body, null, 2),
    "utf-8",
  );
  TEST_SNAPSHOT_IDS.push(id);
}

function makeFileSnapshot(
  id: string,
  label: string,
  options: {
    budgetLines?: {
      id: number;
      category: string;
      subcategory?: string | null;
      lineItem: string;
      owner?: string | null;
      region?: string | null;
      channel?: string | null;
      costStatus?: string;
      projectionPct?: number;
      boardApprovedAmount?: number | null;
    }[];
    monthlyPlans?: {
      id: number;
      budgetLineId: number;
      month: number;
      year: number;
      plannedAmount: number;
      boardAmount?: number | null;
    }[];
    monthlyActuals?: {
      id: number;
      budgetLineId: number;
      month: number;
      year: number;
      actualAmount: number;
      invoiceRef?: string | null;
    }[];
    owners?: { id: number; name: string; initials: string; color: string }[];
    categories?: { id: number; name: string; color: string; description?: string | null }[];
  } = {},
): object {
  return {
    id,
    label,
    createdAt: "2026-01-01T00:00:00.000Z",
    pinned: false,
    data: {
      budgetLines: (options.budgetLines ?? []).map((bl) => ({
        id: bl.id,
        category: bl.category,
        subcategory: bl.subcategory ?? null,
        lineItem: bl.lineItem,
        owner: bl.owner ?? null,
        region: bl.region ?? null,
        channel: bl.channel ?? null,
        costStatus: bl.costStatus ?? "committed",
        projectionPct: bl.projectionPct ?? 100,
        boardApprovedAmount: bl.boardApprovedAmount ?? null,
      })),
      monthlyPlans: (options.monthlyPlans ?? []).map((p) => ({
        id: p.id,
        budgetLineId: p.budgetLineId,
        month: p.month,
        year: p.year,
        plannedAmount: p.plannedAmount,
        boardAmount: p.boardAmount ?? null,
      })),
      monthlyActuals: (options.monthlyActuals ?? []).map((a) => ({
        id: a.id,
        budgetLineId: a.budgetLineId,
        month: a.month,
        year: a.year,
        actualAmount: a.actualAmount,
        invoiceRef: a.invoiceRef ?? null,
      })),
      owners: options.owners ?? [],
      categories: options.categories ?? [],
    },
  };
}

async function restoreDbState(state: SavedDbState): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(monthlyActualsTable);
    await tx.delete(monthlyPlansTable);
    await tx.delete(budgetLinesTable);
    await tx.delete(ownersTable);
    await tx.delete(categoriesTable);

    for (const cat of state.categories) {
      await tx.insert(categoriesTable).values({
        name: cat.name,
        color: cat.color,
        description: cat.description ?? undefined,
      });
    }
    for (const owner of state.owners) {
      await tx.insert(ownersTable).values({
        name: owner.name,
        initials: owner.initials,
        color: owner.color,
      });
    }
    const lineIdMap = new Map<number, number>();
    for (const bl of state.budgetLines) {
      const [inserted] = await tx
        .insert(budgetLinesTable)
        .values({
          category: bl.category,
          subcategory: bl.subcategory ?? undefined,
          lineItem: bl.lineItem,
          owner: bl.owner ?? undefined,
          region: bl.region ?? undefined,
          channel: bl.channel ?? undefined,
          costStatus: bl.costStatus,
          projectionPct: bl.projectionPct,
          boardApprovedAmount: bl.boardApprovedAmount ?? undefined,
        })
        .returning();
      lineIdMap.set(bl.id, inserted.id);
    }
    for (const p of state.monthlyPlans) {
      const newId = lineIdMap.get(p.budgetLineId);
      if (!newId) continue;
      await tx.insert(monthlyPlansTable).values({
        budgetLineId: newId,
        month: p.month,
        year: p.year,
        plannedAmount: p.plannedAmount,
        boardAmount: p.boardAmount ?? undefined,
      });
    }
    for (const a of state.monthlyActuals) {
      const newId = lineIdMap.get(a.budgetLineId);
      if (!newId) continue;
      await tx.insert(monthlyActualsTable).values({
        budgetLineId: newId,
        month: a.month,
        year: a.year,
        actualAmount: a.actualAmount,
        invoiceRef: a.invoiceRef ?? undefined,
      });
    }
  });
}

beforeAll(async () => {
  await loginForTests();
  const [budgetLines, monthlyPlans, monthlyActuals, owners, categories] = await Promise.all([
    db.select().from(budgetLinesTable),
    db.select().from(monthlyPlansTable),
    db.select().from(monthlyActualsTable),
    db.select().from(ownersTable),
    db.select().from(categoriesTable),
  ]);
  savedState = { budgetLines, monthlyPlans, monthlyActuals, owners, categories };
});

afterAll(async () => {
  await cleanupTestUser();
  if (fs.existsSync(SNAPSHOTS_DIR)) {
    for (const file of fs.readdirSync(SNAPSHOTS_DIR)) {
      const id = file.replace(/\.json$/, "");
      if (TEST_SNAPSHOT_IDS.includes(id) || file.includes("pre-restore")) {
        fs.unlinkSync(path.join(SNAPSHOTS_DIR, file));
      }
    }
  }
  await restoreDbState(savedState);
  const { pool } = await import("@workspace/db");
  await pool.end();
});

describe("POST /api/snapshots/:id/restore — error cases", () => {
  it("returns 400 for an ID with invalid characters (special chars)", async () => {
    const res = await req().post("/api/snapshots/invalid%40id%21here/restore");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 for an ID containing non-word characters", async () => {
    const res = await req().post("/api/snapshots/bad!id@here/restore");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 404 when the snapshot does not exist", async () => {
    const res = await req().post("/api/snapshots/snapshot-that-does-not-exist/restore");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe("POST /api/snapshots/:id/restore — restores budget lines", () => {
  beforeEach(async () => {
    await restoreDbState(savedState);
  });

  it("replaces all budget lines with the snapshot's budget lines", async () => {
    const snapId = "test-restore-budget-lines";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "restore-test", {
        budgetLines: [
          { id: 1, category: "Engineering", lineItem: "Cloud Infra" },
          { id: 2, category: "Marketing", lineItem: "Ad Spend", costStatus: "variable", projectionPct: 80 },
        ],
        categories: [
          { id: 10, name: "Engineering", color: "#blue", description: null },
          { id: 11, name: "Marketing", color: "#red", description: null },
        ],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.restoredFrom).toBe(snapId);

    const linesAfter = await db.select().from(budgetLinesTable);
    expect(linesAfter).toHaveLength(2);
    expect(linesAfter.map((l) => l.lineItem).sort()).toEqual(["Ad Spend", "Cloud Infra"]);
  });

  it("replaces budget lines exactly — old lines are removed, not retained", async () => {
    const snapId = "test-restore-single-line";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "restore-single", {
        budgetLines: [
          { id: 1, category: "Finance", lineItem: "Audit Fees" },
        ],
        categories: [{ id: 20, name: "Finance", color: "#green", description: null }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);

    const linesAfter = await db.select().from(budgetLinesTable);
    expect(linesAfter).toHaveLength(1);
    expect(linesAfter[0].lineItem).toBe("Audit Fees");
    expect(linesAfter[0].category).toBe("Finance");
  });
});

describe("POST /api/snapshots/:id/restore — restores monthly plans", () => {
  beforeEach(async () => {
    await restoreDbState(savedState);
  });

  it("restores monthly plans and does not append to pre-existing plans", async () => {
    const snapId = "test-restore-plans";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "restore-plans", {
        budgetLines: [
          { id: 1, category: "Engineering", lineItem: "Salaries" },
        ],
        monthlyPlans: [
          { id: 100, budgetLineId: 1, month: 1, year: 2026, plannedAmount: 50000 },
          { id: 101, budgetLineId: 1, month: 2, year: 2026, plannedAmount: 52000 },
        ],
        categories: [{ id: 30, name: "Engineering", color: "#purple", description: null }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);

    const linesAfter = await db.select().from(budgetLinesTable);
    expect(linesAfter).toHaveLength(1);

    const plansAfter = await db.select().from(monthlyPlansTable);
    expect(plansAfter).toHaveLength(2);
    expect(plansAfter.map((p) => p.month).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(plansAfter.map((p) => p.plannedAmount).sort((a, b) => a - b)).toEqual([50000, 52000]);
    for (const p of plansAfter) {
      expect(p.budgetLineId).toBe(linesAfter[0].id);
    }
  });

  it("clears plans when the snapshot budget lines have no plans", async () => {
    const snapId = "test-restore-no-plans";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "restore-no-plans", {
        budgetLines: [{ id: 1, category: "Ops", lineItem: "Utilities" }],
        monthlyPlans: [],
        categories: [{ id: 40, name: "Ops", color: "#gray", description: null }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);

    expect(await db.select().from(monthlyPlansTable)).toHaveLength(0);
  });
});

describe("POST /api/snapshots/:id/restore — restores monthly actuals", () => {
  beforeEach(async () => {
    await restoreDbState(savedState);
  });

  it("restores monthly actuals and does not append to pre-existing actuals", async () => {
    const snapId = "test-restore-actuals";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "restore-actuals", {
        budgetLines: [
          { id: 1, category: "Sales", lineItem: "Commission", costStatus: "variable", projectionPct: 90 },
        ],
        monthlyActuals: [
          { id: 200, budgetLineId: 1, month: 3, year: 2026, actualAmount: 12000, invoiceRef: "INV-001" },
          { id: 201, budgetLineId: 1, month: 4, year: 2026, actualAmount: 15000, invoiceRef: "INV-002" },
        ],
        categories: [{ id: 50, name: "Sales", color: "#orange", description: null }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);

    const actualsAfter = await db.select().from(monthlyActualsTable);
    expect(actualsAfter).toHaveLength(2);
    expect(actualsAfter.map((a) => a.invoiceRef).sort()).toEqual(["INV-001", "INV-002"]);
    expect(actualsAfter.map((a) => a.actualAmount).sort((a, b) => a - b)).toEqual([12000, 15000]);
  });

  it("clears actuals when the snapshot has no actuals", async () => {
    const snapId = "test-restore-no-actuals";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "restore-no-actuals", {
        budgetLines: [{ id: 1, category: "Sales", lineItem: "Commission" }],
        monthlyActuals: [],
        categories: [{ id: 50, name: "Sales", color: "#orange", description: null }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);

    expect(await db.select().from(monthlyActualsTable)).toHaveLength(0);
  });
});

describe("POST /api/snapshots/:id/restore — pre-restore backup", () => {
  beforeEach(async () => {
    await restoreDbState(savedState);
  });

  it("creates a pre-restore backup snapshot with label 'pre-restore' before touching the database", async () => {
    const snapId = "test-restore-backup-check";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "backup-check", {
        budgetLines: [{ id: 1, category: "HR", lineItem: "Recruiting" }],
        categories: [{ id: 60, name: "HR", color: "#teal", description: null }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.preRestoreSnapshot).toBeDefined();
    expect(res.body.preRestoreSnapshot.id).toBeTruthy();
    expect(res.body.preRestoreSnapshot.label).toBe("pre-restore");

    const preRestoreFile = path.join(SNAPSHOTS_DIR, `${res.body.preRestoreSnapshot.id as string}.json`);
    expect(fs.existsSync(preRestoreFile)).toBe(true);
  });

  it("returns success:true, restoredFrom matching the requested id, and preRestoreSnapshot metadata", async () => {
    const snapId = "test-restore-response-shape";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "response-shape", {
        budgetLines: [{ id: 1, category: "Legal", lineItem: "Outside Counsel" }],
        categories: [{ id: 70, name: "Legal", color: "#navy", description: null }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.restoredFrom).toBe(snapId);
    expect(typeof res.body.preRestoreSnapshot.id).toBe("string");
    expect(typeof res.body.preRestoreSnapshot.createdAt).toBe("string");
  });
});

describe("POST /api/snapshots/:id/restore — full fidelity", () => {
  beforeEach(async () => {
    await restoreDbState(savedState);
  });

  it("restores all budget line fields including subcategory, owner, region, channel, projectionPct, boardApprovedAmount", async () => {
    const snapId = "test-restore-full-fields";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "full-fields", {
        budgetLines: [
          {
            id: 1,
            category: "Engineering",
            subcategory: "Infrastructure",
            lineItem: "Cloud Compute",
            owner: "Alice",
            region: "US",
            channel: "Direct",
            costStatus: "committed",
            projectionPct: 75,
            boardApprovedAmount: 100000,
          },
        ],
        categories: [{ id: 80, name: "Engineering", color: "#blue", description: "Tech" }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);

    const linesAfter = await db.select().from(budgetLinesTable);
    expect(linesAfter).toHaveLength(1);

    const bl = linesAfter[0];
    expect(bl.category).toBe("Engineering");
    expect(bl.subcategory).toBe("Infrastructure");
    expect(bl.lineItem).toBe("Cloud Compute");
    expect(bl.owner).toBe("Alice");
    expect(bl.region).toBe("US");
    expect(bl.channel).toBe("Direct");
    expect(bl.costStatus).toBe("committed");
    expect(bl.projectionPct).toBe(75);
    expect(bl.boardApprovedAmount).toBe(100000);
  });

  it("remaps budget line IDs for plans using new DB-assigned IDs, not snapshot IDs", async () => {
    const snapId = "test-restore-id-remap";
    writeTestSnapshot(
      snapId,
      makeFileSnapshot(snapId, "id-remap", {
        budgetLines: [
          { id: 999, category: "Finance", lineItem: "Audit" },
        ],
        monthlyPlans: [
          { id: 888, budgetLineId: 999, month: 6, year: 2026, plannedAmount: 20000 },
        ],
        categories: [{ id: 90, name: "Finance", color: "#gold", description: null }],
      }),
    );

    const res = await req().post(`/api/snapshots/${snapId}/restore`);
    expect(res.status).toBe(200);

    const linesAfter = await db.select().from(budgetLinesTable);
    expect(linesAfter).toHaveLength(1);

    const plansAfter = await db.select().from(monthlyPlansTable);
    expect(plansAfter).toHaveLength(1);
    expect(plansAfter[0].budgetLineId).toBe(linesAfter[0].id);
    expect(plansAfter[0].plannedAmount).toBe(20000);
    expect(plansAfter[0].month).toBe(6);
    expect(plansAfter[0].year).toBe(2026);
  });
});
