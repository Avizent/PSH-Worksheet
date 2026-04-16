import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  db,
  monthlyActualsTable,
  budgetLinesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

interface ImportRow {
  id: number;
  status: string;
  budgetLineId: number | null;
  rawAmount: number | null;
  errorMessage: string | null;
}

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

describe("CSV upload validation", () => {
  it("rejects upload with no file attached", async () => {
    const res = await request(app).post("/api/imports/upload");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });

  it("rejects CSV with only a header row (no data rows)", async () => {
    const csv = TEST_CSV_HEADER;
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "header-only.csv");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/header row and at least one data row/i);
  });

  it("rejects CSV missing the Amount column", async () => {
    const csv = "Category,Line Item,Month,Year,InvoiceRef\nFoo,Bar,Jan,2090,INV-1";
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "no-amount.csv");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/i);
  });

  it("rejects a file exceeding the 5MB limit", async () => {
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024, "x");
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", bigBuffer, "huge.csv");
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it("marks rows with invalid amounts as errors", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jan,2090,NOT_A_NUMBER,INV-BAD-AMT`,
    ]);
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "bad-amount.csv");
    expect(res.status).toBe(201);

    const errorRows = res.body.rows.filter((r: ImportRow) => r.status === "error");
    expect(errorRows).toHaveLength(1);
    expect(errorRows[0].errorMessage).toMatch(/amount/i);

    await request(app).delete(`/api/imports/${res.body.id}`);
  });

  it("marks rows with invalid months as errors", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},InvalidMonth,2090,500,INV-BAD-MON`,
    ]);
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "bad-month.csv");
    expect(res.status).toBe(201);

    const errorRows = res.body.rows.filter((r: ImportRow) => r.status === "error");
    expect(errorRows).toHaveLength(1);
    expect(errorRows[0].errorMessage).toMatch(/month/i);

    await request(app).delete(`/api/imports/${res.body.id}`);
  });

  it("accepts CSV with alternative Amount column name 'Actual'", async () => {
    const csv = "Category,Line Item,Month,Year,Actual,InvoiceRef\n" +
      `${testCategory},${testBudgetLineItem},Mar,2090,750,INV-ALT-COL`;
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "alt-col.csv");
    expect(res.status).toBe(201);
    expect(res.body.rows).toHaveLength(1);

    await request(app).delete(`/api/imports/${res.body.id}`);
  });

  it("handles mixed valid and invalid rows correctly", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jan,2090,100,INV-MIX-OK`,
      `${testCategory},${testBudgetLineItem},,2090,200,INV-MIX-NOMONTH`,
      `${testCategory},${testBudgetLineItem},Mar,2090,,INV-MIX-NOAMT`,
    ]);
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "mixed.csv");
    expect(res.status).toBe(201);

    const matched = res.body.rows.filter((r: ImportRow) => r.status === "matched");
    const errors = res.body.rows.filter((r: ImportRow) => r.status === "error");
    expect(matched).toHaveLength(1);
    expect(errors).toHaveLength(2);

    await request(app).delete(`/api/imports/${res.body.id}`);
  });
});

describe("Row assignment (PATCH /imports/rows/:id/assign)", () => {
  let importId: number;
  let unmatchedRowId: number;

  beforeAll(async () => {
    const csv = "Month,Year,Amount,InvoiceRef\nJan,2091,500,INV-ASSIGN-1";
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "unmatched.csv");
    expect(res.status).toBe(201);
    importId = res.body.id;
    const unmatched = res.body.rows.filter((r: ImportRow) => r.status === "unmatched");
    expect(unmatched.length).toBeGreaterThan(0);
    unmatchedRowId = unmatched[0].id;
  });

  afterAll(async () => {
    await request(app).delete(`/api/imports/${importId}`);
  });

  it("assigns an unmatched row to a budget line", async () => {
    const res = await request(app)
      .patch(`/api/imports/rows/${unmatchedRowId}/assign`)
      .send({ budgetLineId: testBudgetLineId });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("matched");
    expect(res.body.budgetLineId).toBe(testBudgetLineId);
  });

  it("rejects assigning a row that is already matched", async () => {
    const res = await request(app)
      .patch(`/api/imports/rows/${unmatchedRowId}/assign`)
      .send({ budgetLineId: testBudgetLineId });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/already matched/i);
  });

  it("rejects assignment with a non-existent budget line", async () => {
    const csv = "Month,Year,Amount,InvoiceRef\nFeb,2091,600,INV-ASSIGN-2";
    const uploadRes = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "unmatched2.csv");
    const rowId = uploadRes.body.rows[0].id;

    const res = await request(app)
      .patch(`/api/imports/rows/${rowId}/assign`)
      .send({ budgetLineId: 999999 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/budget line not found/i);

    await request(app).delete(`/api/imports/${uploadRes.body.id}`);
  });

  it("rejects assignment with missing budgetLineId in body", async () => {
    const csv = "Month,Year,Amount,InvoiceRef\nMar,2091,700,INV-ASSIGN-3";
    const uploadRes = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "unmatched3.csv");
    const rowId = uploadRes.body.rows[0].id;

    const res = await request(app)
      .patch(`/api/imports/rows/${rowId}/assign`)
      .send({});
    expect(res.status).toBe(400);

    await request(app).delete(`/api/imports/${uploadRes.body.id}`);
  });

  it("rejects assignment with invalid row id", async () => {
    const res = await request(app)
      .patch("/api/imports/rows/abc/assign")
      .send({ budgetLineId: testBudgetLineId });
    expect(res.status).toBe(400);
  });

  it("updates import status from needs_review to ready when last unmatched row is assigned", async () => {
    const csv = "Month,Year,Amount,InvoiceRef\nApr,2091,800,INV-ASSIGN-4";
    const uploadRes = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "unmatched4.csv");
    expect(uploadRes.status).toBe(201);
    const upImportId = uploadRes.body.id;
    expect(uploadRes.body.status).toBe("needs_review");

    const rowId = uploadRes.body.rows[0].id;
    await request(app)
      .patch(`/api/imports/rows/${rowId}/assign`)
      .send({ budgetLineId: testBudgetLineId });

    const getRes = await request(app).get(`/api/imports/${upImportId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("ready");

    await request(app).delete(`/api/imports/${upImportId}`);
  });
});

describe("Confirm idempotency (confirming twice skips duplicates)", () => {
  const TEST_YEAR = 2092;
  let importId: number;

  it("first confirm creates actuals", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jan,${TEST_YEAR},1500,INV-IDEMPOTENT-1`,
      `${testCategory},${testBudgetLineItem},Feb,${TEST_YEAR},2500,INV-IDEMPOTENT-2`,
    ]);

    const uploadRes = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "idempotent.csv");
    expect(uploadRes.status).toBe(201);
    importId = uploadRes.body.id;

    const confirmRes = await request(app).post(`/api/imports/${importId}/confirm`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.created).toBe(2);
    expect(confirmRes.body.skippedDuplicate).toBe(0);
  });

  it("second confirm returns zero created and reports all as skipped", async () => {
    const confirmRes = await request(app).post(`/api/imports/${importId}/confirm`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.created).toBe(0);
    expect(confirmRes.body.skippedDuplicate).toBeGreaterThan(0);
  });

  it("actuals count remains the same after double confirm", async () => {
    const actuals = await db.select().from(monthlyActualsTable)
      .where(eq(monthlyActualsTable.importId, importId));
    expect(actuals).toHaveLength(2);

    await request(app).delete(`/api/imports/${importId}`);
  });
});

describe("Confirm with cross-import duplicate detection", () => {
  const TEST_YEAR = 2093;
  let importAId: number;
  let importBId: number;

  it("confirms import A, then import B with identical rows skips duplicates", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},May,${TEST_YEAR},3000,INV-XDUP-1`,
    ]);

    const uploadA = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "xdup-a.csv");
    importAId = uploadA.body.id;
    const confirmA = await request(app).post(`/api/imports/${importAId}/confirm`);
    expect(confirmA.body.created).toBe(1);

    const uploadB = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "xdup-b.csv");
    importBId = uploadB.body.id;
    const confirmB = await request(app).post(`/api/imports/${importBId}/confirm`);
    expect(confirmB.body.created).toBe(0);
    expect(confirmB.body.skippedDuplicate).toBe(1);
  });

  afterAll(async () => {
    await request(app).delete(`/api/imports/${importBId}`);
    await request(app).delete(`/api/imports/${importAId}`);
  });
});

describe("Edge case: empty CSV body (header only)", () => {
  it("returns 400 for CSV with no data rows", async () => {
    const csv = TEST_CSV_HEADER + "\n";
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "empty.csv");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/header row and at least one data row/i);
  });
});

describe("Edge case: all rows unmatched", () => {
  let importId: number;

  it("uploads CSV where no rows match any budget line", async () => {
    const csv = buildCsv([
      "UnknownCategory,UnknownItem,Jan,2094,100,INV-NOMATCH-1",
      "UnknownCategory,UnknownItem,Feb,2094,200,INV-NOMATCH-2",
    ]);
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "all-unmatched.csv");
    expect(res.status).toBe(201);
    importId = res.body.id;

    expect(res.body.status).toBe("needs_review");
    const unmatched = res.body.rows.filter((r: ImportRow) => r.status === "unmatched");
    expect(unmatched).toHaveLength(2);
    expect(res.body.matchedRows).toBe(0);
    expect(res.body.unmatchedRows).toBe(2);
  });

  it("confirming with all-unmatched rows creates zero actuals", async () => {
    const confirmRes = await request(app).post(`/api/imports/${importId}/confirm`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.created).toBe(0);
    expect(confirmRes.body.skippedUnmatched).toBe(2);
  });

  afterAll(async () => {
    await request(app).delete(`/api/imports/${importId}`);
  });
});

describe("Edge case: all rows have errors", () => {
  it("uploads CSV where every row has parse errors", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},,2094,,INV-ALLERR-1`,
      `${testCategory},${testBudgetLineItem},BadMonth,2094,abc,INV-ALLERR-2`,
    ]);
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "all-errors.csv");
    expect(res.status).toBe(201);

    const errorRows = res.body.rows.filter((r: ImportRow) => r.status === "error");
    expect(errorRows).toHaveLength(2);
    expect(res.body.errorRows).toBe(2);
    expect(res.body.matchedRows).toBe(0);

    await request(app).delete(`/api/imports/${res.body.id}`);
  });
});

describe("GET /imports/:id", () => {
  let importId: number;

  beforeAll(async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jan,2089,100,INV-GETONE`,
    ]);
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "get-test.csv");
    importId = res.body.id;
  });

  afterAll(async () => {
    await request(app).delete(`/api/imports/${importId}`);
  });

  it("returns the import with its rows", async () => {
    const res = await request(app).get(`/api/imports/${importId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(importId);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].rawAmount).toBe(100);
  });

  it("returns 404 for a non-existent import id", async () => {
    const res = await request(app).get("/api/imports/999999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid import id", async () => {
    const res = await request(app).get("/api/imports/abc");
    expect(res.status).toBe(400);
  });
});

describe("Confirm edge cases", () => {
  it("returns 404 when confirming a non-existent import", async () => {
    const res = await request(app).post("/api/imports/999999/confirm");
    expect(res.status).toBe(404);
  });

  it("returns 400 when confirming a deleted import", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jun,2088,100,INV-DEL-CONFIRM`,
    ]);
    const uploadRes = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "del-confirm.csv");
    const id = uploadRes.body.id;

    await request(app).delete(`/api/imports/${id}`);

    const confirmRes = await request(app).post(`/api/imports/${id}/confirm`);
    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.error).toMatch(/deleted/i);
  });
});

describe("Delete edge cases", () => {
  it("returns 404 when deleting a non-existent import", async () => {
    const res = await request(app).delete("/api/imports/999999");
    expect(res.status).toBe(404);
  });

  it("returns 400 when deleting an already-deleted import", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Jul,2088,100,INV-DOUBLE-DEL`,
    ]);
    const uploadRes = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "double-del.csv");
    const id = uploadRes.body.id;

    const firstDel = await request(app).delete(`/api/imports/${id}`);
    expect(firstDel.status).toBe(200);

    const secondDel = await request(app).delete(`/api/imports/${id}`);
    expect(secondDel.status).toBe(400);
    expect(secondDel.body.error).toMatch(/already deleted/i);
  });
});

describe("CSV with quoted fields and special characters", () => {
  it("correctly parses quoted fields containing commas", async () => {
    const csv = 'Category,Line Item,Month,Year,Amount,InvoiceRef\n' +
      `"${testCategory}","${testBudgetLineItem}",Jan,2087,"1,500.00",INV-QUOTED`;
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "quoted.csv");
    expect(res.status).toBe(201);

    const matchedRows = res.body.rows.filter((r: ImportRow) => r.status === "matched");
    expect(matchedRows).toHaveLength(1);
    expect(matchedRows[0].rawAmount).toBe(1500);

    await request(app).delete(`/api/imports/${res.body.id}`);
  });

  it("handles currency symbols in amounts", async () => {
    const csv = buildCsv([
      `${testCategory},${testBudgetLineItem},Feb,2087,$2500,INV-DOLLAR`,
      `${testCategory},${testBudgetLineItem},Mar,2087,£3500,INV-POUND`,
    ]);
    const res = await request(app)
      .post("/api/imports/upload")
      .attach("file", Buffer.from(csv), "currency.csv");
    expect(res.status).toBe(201);

    const matchedRows = res.body.rows.filter((r: ImportRow) => r.status === "matched");
    expect(matchedRows).toHaveLength(2);
    expect(matchedRows[0].rawAmount).toBe(2500);
    expect(matchedRows[1].rawAmount).toBe(3500);

    await request(app).delete(`/api/imports/${res.body.id}`);
  });
});

describe("GET /imports list endpoint", () => {
  it("returns an array of imports", async () => {
    const res = await request(app).get("/api/imports");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
