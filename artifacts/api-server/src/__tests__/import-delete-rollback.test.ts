import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  db,
  monthlyActualsTable,
  csvImportsTable,
  csvImportRowsTable,
  budgetLinesTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const TEST_CSV_HEADER = "Category,Line Item,Month,Year,Amount,InvoiceRef";

function buildCsv(rows: string[]): string {
  return [TEST_CSV_HEADER, ...rows].join("\n");
}

let testBudgetLineId: number;
let testBudgetLineItem: string;
let testCategory: string;

beforeAll(async () => {
  const lines = await db.select().from(budgetLinesTable).limit(1);
  if (lines.length === 0) {
    throw new Error("No budget lines in DB — seed data first");
  }
  testBudgetLineId = lines[0].id;
  testBudgetLineItem = lines[0].lineItem;
  testCategory = lines[0].category ?? "General";
});

afterAll(async () => {
  const { pool } = await import("@workspace/db");
  await pool.end();
});

async function getDashboardSpent(year: number): Promise<number> {
  const res = await request(app).get(`/api/dashboard/summary?year=${year}`);
  return res.body.spentYtd;
}

async function uploadAndConfirm(csvBody: string) {
  const uploadRes = await request(app)
    .post("/api/imports/upload")
    .attach("file", Buffer.from(csvBody), "test.csv");
  expect(uploadRes.status).toBe(201);

  const importId = uploadRes.body.id;
  const rows = uploadRes.body.rows as Array<{ id: number; status: string; budgetLineId: number | null }>;

  for (const row of rows) {
    if (row.status === "unmatched") {
      const assignRes = await request(app)
        .patch(`/api/imports/rows/${row.id}/assign`)
        .send({ budgetLineId: testBudgetLineId });
      expect(assignRes.status).toBe(200);
    }
  }

  const confirmRes = await request(app).post(`/api/imports/${importId}/confirm`);
  expect(confirmRes.status).toBe(200);
  expect(confirmRes.body.created).toBeGreaterThan(0);

  return { importId, created: confirmRes.body.created as number };
}

describe("Import delete rolls back actuals (importId path)", () => {
  const TEST_YEAR = 2099;
  let importId: number;
  let createdCount: number;

  it("uploads and confirms a CSV, creating actuals", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jan,${TEST_YEAR},1000,INV-ROLLBACK-1`,
      `${testCategory},${testBudgetLineItem},Feb,${TEST_YEAR},2000,INV-ROLLBACK-2`,
    ]);

    const result = await uploadAndConfirm(csv);
    importId = result.importId;
    createdCount = result.created;

    expect(createdCount).toBe(2);

    const actuals = await db.select().from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.importId, importId));
    expect(actuals).toHaveLength(2);
  });

  it("dashboard reflects the imported actuals", async () => {
    const spent = await getDashboardSpent(TEST_YEAR);
    expect(spent).toBe(3000);
  });

  it("deletes the import and removes all actuals", async () => {
    const deleteRes = await request(app).delete(`/api/imports/${importId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
    expect(deleteRes.body.previousStatus).toBe("confirmed");

    const actuals = await db.select().from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.importId, importId));
    expect(actuals).toHaveLength(0);
  });

  it("dashboard totals decrease after delete", async () => {
    const spent = await getDashboardSpent(TEST_YEAR);
    expect(spent).toBe(0);
  });

  it("import is marked as deleted", async () => {
    const [imp] = await db.select().from(csvImportsTable)
      .where(eq(csvImportsTable.id, importId));
    expect(imp.status).toBe("deleted");
    expect(imp.deletedAt).not.toBeNull();
  });

  it("import rows are removed", async () => {
    const rows = await db.select().from(csvImportRowsTable)
      .where(eq(csvImportRowsTable.importId, importId));
    expect(rows).toHaveLength(0);
  });
});

describe("Import delete rolls back actuals (hash fallback path)", () => {
  const TEST_YEAR = 2098;
  let importId: number;

  it("uploads and confirms a CSV, then nullifies importId to simulate legacy data", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Mar,${TEST_YEAR},500,INV-LEGACY-1`,
      `${testCategory},${testBudgetLineItem},Apr,${TEST_YEAR},750,INV-LEGACY-2`,
    ]);

    const result = await uploadAndConfirm(csv);
    importId = result.importId;
    expect(result.created).toBe(2);

    await db.update(monthlyActualsTable)
      .set({ importId: null })
      .where(eq(monthlyActualsTable.importId, importId));

    const actuals = await db.select().from(monthlyActualsTable)
      .where(and(
        eq(monthlyActualsTable.year, TEST_YEAR),
        eq(monthlyActualsTable.budgetLineId, testBudgetLineId),
      ));
    expect(actuals).toHaveLength(2);
    expect(actuals.every(a => a.importId === null)).toBe(true);
  });

  it("dashboard reflects the legacy actuals", async () => {
    const spent = await getDashboardSpent(TEST_YEAR);
    expect(spent).toBe(1250);
  });

  it("deletes the import and removes legacy actuals via hash fallback", async () => {
    const deleteRes = await request(app).delete(`/api/imports/${importId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    const actuals = await db.select().from(monthlyActualsTable)
      .where(and(
        eq(monthlyActualsTable.year, TEST_YEAR),
        eq(monthlyActualsTable.budgetLineId, testBudgetLineId),
      ));
    expect(actuals).toHaveLength(0);
  });

  it("dashboard totals decrease after legacy delete", async () => {
    const spent = await getDashboardSpent(TEST_YEAR);
    expect(spent).toBe(0);
  });
});

describe("Import delete rolls back actuals (mixed state — some with importId, some without)", () => {
  const TEST_YEAR = 2096;
  let importId: number;

  it("uploads and confirms a CSV, then nullifies importId on one row to simulate mixed state", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jan,${TEST_YEAR},300,INV-MIXED-1`,
      `${testCategory},${testBudgetLineItem},Feb,${TEST_YEAR},400,INV-MIXED-2`,
      `${testCategory},${testBudgetLineItem},Mar,${TEST_YEAR},500,INV-MIXED-3`,
    ]);

    const result = await uploadAndConfirm(csv);
    importId = result.importId;
    expect(result.created).toBe(3);

    const actuals = await db.select().from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.importId, importId));
    expect(actuals).toHaveLength(3);

    await db.update(monthlyActualsTable)
      .set({ importId: null })
      .where(and(
        eq(monthlyActualsTable.importId, importId),
        eq(monthlyActualsTable.month, 2),
      ));

    const withFk = await db.select().from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.importId, importId));
    expect(withFk).toHaveLength(2);
  });

  it("deletes the import and removes ALL actuals (both FK and hash-matched)", async () => {
    const deleteRes = await request(app).delete(`/api/imports/${importId}`);
    expect(deleteRes.status).toBe(200);

    const remaining = await db.select().from(monthlyActualsTable)
      .where(and(
        eq(monthlyActualsTable.year, TEST_YEAR),
        eq(monthlyActualsTable.budgetLineId, testBudgetLineId),
      ));
    expect(remaining).toHaveLength(0);
  });

  it("dashboard shows zero for the test year", async () => {
    const spent = await getDashboardSpent(TEST_YEAR);
    expect(spent).toBe(0);
  });
});

describe("Delete of duplicate import does not remove the original import's actuals", () => {
  const TEST_YEAR = 2095;

  let importAId: number;
  let importBId: number;

  it("imports and confirms CSV A, then imports the same CSV B (duplicates skipped)", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jan,${TEST_YEAR},1111,INV-DUP-A`,
      `${testCategory},${testBudgetLineItem},Feb,${TEST_YEAR},2222,INV-DUP-B`,
    ]);

    const resultA = await uploadAndConfirm(csv);
    importAId = resultA.importId;
    expect(resultA.created).toBe(2);

    const uploadB = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "dup.csv");
    expect(uploadB.status).toBe(201);
    importBId = uploadB.body.id;

    const confirmB = await request(app).post(`/api/imports/${importBId}/confirm`);
    expect(confirmB.status).toBe(200);
    expect(confirmB.body.created).toBe(0);
    expect(confirmB.body.skippedDuplicate).toBe(2);
  });

  it("deleting import B does NOT remove import A's actuals", async () => {
    const deleteRes = await request(app).delete(`/api/imports/${importBId}`);
    expect(deleteRes.status).toBe(200);

    const actuals = await db.select().from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.importId, importAId));
    expect(actuals).toHaveLength(2);
  });

  it("dashboard still reflects import A's data", async () => {
    const spent = await getDashboardSpent(TEST_YEAR);
    expect(spent).toBe(3333);
  });

  it("deleting import A removes its actuals", async () => {
    const deleteRes = await request(app).delete(`/api/imports/${importAId}`);
    expect(deleteRes.status).toBe(200);

    const actuals = await db.select().from(monthlyActualsTable)
      .where(and(
        eq(monthlyActualsTable.year, TEST_YEAR),
        eq(monthlyActualsTable.budgetLineId, testBudgetLineId),
      ));
    expect(actuals).toHaveLength(0);

    const spent = await getDashboardSpent(TEST_YEAR);
    expect(spent).toBe(0);
  });
});

describe("Delete of non-confirmed import does not touch actuals", () => {
  it("uploads a CSV without confirming and deletes it", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jun,2097,999,INV-NOCONFIRM`,
    ]);

    const uploadRes = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "noconfirm.csv");
    expect(uploadRes.status).toBe(201);

    const importId = uploadRes.body.id;

    const [totalBefore] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(monthlyActualsTable);

    const deleteRes = await request(app).delete(`/api/imports/${importId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.previousStatus).not.toBe("confirmed");

    const [totalAfter] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(monthlyActualsTable);

    expect(Number(totalAfter.count)).toBe(Number(totalBefore.count));
  });
});
