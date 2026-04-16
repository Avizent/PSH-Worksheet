import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, and, inArray } from "drizzle-orm";
import multer, { MulterError } from "multer";
import crypto from "crypto";
import {
  db,
  budgetLinesTable,
  monthlyActualsTable,
  csvImportsTable,
  csvImportRowsTable,
} from "@workspace/db";
import {
  ListImportsResponse,
  GetImportResponse,
  AssignImportRowBody,
  AssignImportRowResponse,
  ConfirmImportResponse,
  GetImportParams,
  ConfirmImportParams,
  AssignImportRowParams,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { writeAuditLog } from "../middleware/auditLog";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router: IRouter = Router();

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hashRow(category: string, lineItem: string, month: number, year: number, amount: number, invoiceRef: string): string {
  const payload = `${category}|${lineItem}|${month}|${year}|${amount}|${invoiceRef}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseMonth(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) return num;
  return MONTH_MAP[trimmed] ?? null;
}

router.get("/imports", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(csvImportsTable).orderBy(csvImportsTable.createdAt);
  res.json(ListImportsResponse.parse(rows));
}));

function handleMulterError(err: Error, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large. Maximum size is 5MB." });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
}

router.post("/imports/upload", upload.single("file"), handleMulterError, asyncHandler(async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const csvContent = file.buffer.toString("utf-8");
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lines.length < 2) {
    res.status(400).json({ error: "CSV must have a header row and at least one data row" });
    return;
  }

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map(h => normalise(h));

  const catIdx = headers.findIndex(h => h === "category" || h === "cat");
  const lineItemIdx = headers.findIndex(h => h === "lineitem" || h === "line" || h === "description" || h === "item");
  const monthIdx = headers.findIndex(h => h === "month" || h === "mon");
  const yearIdx = headers.findIndex(h => h === "year" || h === "yr");
  const amountIdx = headers.findIndex(h => h === "amount" || h === "actual" || h === "actualamount" || h === "spend");
  const invoiceIdx = headers.findIndex(h => h === "invoiceref" || h === "invoice" || h === "ref" || h === "reference");

  if (amountIdx === -1) {
    res.status(400).json({ error: "CSV must contain an 'Amount' or 'Actual' column" });
    return;
  }

  const budgetLines = await db.select().from(budgetLinesTable);
  const linesByNormName = new Map<string, typeof budgetLines[0]>();
  const linesByCatAndItem = new Map<string, typeof budgetLines[0]>();

  for (const bl of budgetLines) {
    linesByNormName.set(normalise(bl.lineItem), bl);
    if (bl.category) {
      linesByCatAndItem.set(normalise(bl.category) + "|" + normalise(bl.lineItem), bl);
    }
  }

  const [importRecord] = await db.insert(csvImportsTable).values({
    filename: file.originalname || "upload.csv",
    status: "pending",
    totalRows: lines.length - 1,
  }).returning();

  const rowInserts: Array<{
    importId: number;
    rowIndex: number;
    rawCategory: string | null;
    rawLineItem: string | null;
    rawMonth: number | null;
    rawYear: number | null;
    rawAmount: number | null;
    rawInvoiceRef: string | null;
    status: string;
    budgetLineId: number | null;
    errorMessage: string | null;
    rowHash: string | null;
  }> = [];

  let matched = 0;
  let unmatched = 0;
  let errors = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rawCategory = catIdx >= 0 ? (cols[catIdx] || null) : null;
    const rawLineItem = lineItemIdx >= 0 ? (cols[lineItemIdx] || null) : null;
    const rawMonthStr = monthIdx >= 0 ? (cols[monthIdx] || "") : "";
    const rawYearStr = yearIdx >= 0 ? (cols[yearIdx] || "") : "";
    const rawAmountStr = amountIdx >= 0 ? (cols[amountIdx] || "") : "";
    const rawInvoiceRef = invoiceIdx >= 0 ? (cols[invoiceIdx] || null) : null;

    const rawMonth = parseMonth(rawMonthStr);
    const rawYear = rawYearStr ? parseInt(rawYearStr, 10) : null;
    const rawAmount = rawAmountStr ? parseFloat(rawAmountStr.replace(/[£$,]/g, "")) : null;

    if (rawAmount == null || isNaN(rawAmount)) {
      errors++;
      rowInserts.push({
        importId: importRecord.id,
        rowIndex: i,
        rawCategory,
        rawLineItem,
        rawMonth,
        rawYear: rawYear && !isNaN(rawYear) ? rawYear : null,
        rawAmount: null,
        rawInvoiceRef,
        status: "error",
        budgetLineId: null,
        errorMessage: "Invalid or missing amount",
        rowHash: null,
      });
      continue;
    }

    if (rawMonth == null) {
      errors++;
      rowInserts.push({
        importId: importRecord.id,
        rowIndex: i,
        rawCategory,
        rawLineItem,
        rawMonth: null,
        rawYear: rawYear && !isNaN(rawYear) ? rawYear : null,
        rawAmount,
        rawInvoiceRef,
        status: "error",
        budgetLineId: null,
        errorMessage: "Invalid or missing month",
        rowHash: null,
      });
      continue;
    }

    const yearVal = rawYear && !isNaN(rawYear) ? rawYear : new Date().getFullYear();

    const rHash = hashRow(
      rawCategory || "",
      rawLineItem || "",
      rawMonth,
      yearVal,
      rawAmount,
      rawInvoiceRef || ""
    );

    let matchedLine: typeof budgetLines[0] | undefined;

    if (rawCategory && rawLineItem) {
      matchedLine = linesByCatAndItem.get(normalise(rawCategory) + "|" + normalise(rawLineItem));
    }
    if (!matchedLine && rawLineItem) {
      matchedLine = linesByNormName.get(normalise(rawLineItem));
    }

    if (matchedLine) {
      matched++;
      rowInserts.push({
        importId: importRecord.id,
        rowIndex: i,
        rawCategory,
        rawLineItem,
        rawMonth,
        rawYear: yearVal,
        rawAmount,
        rawInvoiceRef,
        status: "matched",
        budgetLineId: matchedLine.id,
        errorMessage: null,
        rowHash: rHash,
      });
    } else {
      unmatched++;
      rowInserts.push({
        importId: importRecord.id,
        rowIndex: i,
        rawCategory,
        rawLineItem,
        rawMonth,
        rawYear: yearVal,
        rawAmount,
        rawInvoiceRef,
        status: "unmatched",
        budgetLineId: null,
        errorMessage: null,
        rowHash: rHash,
      });
    }
  }

  if (rowInserts.length > 0) {
    await db.insert(csvImportRowsTable).values(rowInserts);
  }

  await db.update(csvImportsTable).set({
    matchedRows: matched,
    unmatchedRows: unmatched,
    errorRows: errors,
    status: unmatched > 0 ? "needs_review" : "ready",
  }).where(eq(csvImportsTable.id, importRecord.id));

  const updatedImport = await db.select().from(csvImportsTable).where(eq(csvImportsTable.id, importRecord.id));
  const importRows = await db.select().from(csvImportRowsTable).where(eq(csvImportRowsTable.importId, importRecord.id)).orderBy(csvImportRowsTable.rowIndex);

  await writeAuditLog({
    action: "create",
    entityType: "csv_import",
    entityId: importRecord.id,
    field: "filename",
    newValue: file.originalname,
  });

  res.status(201).json(GetImportResponse.parse({
    ...updatedImport[0],
    rows: importRows,
  }));
}));

router.get("/imports/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = GetImportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [imp] = await db.select().from(csvImportsTable).where(eq(csvImportsTable.id, params.data.id));
  if (!imp) {
    res.status(404).json({ error: "Import not found" });
    return;
  }

  const rows = await db.select().from(csvImportRowsTable).where(eq(csvImportRowsTable.importId, imp.id)).orderBy(csvImportRowsTable.rowIndex);

  res.json(GetImportResponse.parse({ ...imp, rows }));
}));

router.patch("/imports/rows/:id/assign", asyncHandler(async (req, res): Promise<void> => {
  const params = AssignImportRowParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = AssignImportRowBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [bl] = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.id, body.data.budgetLineId));
  if (!bl) {
    res.status(404).json({ error: "Budget line not found" });
    return;
  }

  const [updated] = await db
    .update(csvImportRowsTable)
    .set({ budgetLineId: body.data.budgetLineId, status: "matched" })
    .where(and(eq(csvImportRowsTable.id, params.data.id), eq(csvImportRowsTable.status, "unmatched")))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Import row not found or already matched" });
    return;
  }

  const imp = await db.select().from(csvImportsTable).where(eq(csvImportsTable.id, updated.importId));
  if (imp[0]) {
    const remainingUnmatched = await db.select().from(csvImportRowsTable)
      .where(and(eq(csvImportRowsTable.importId, updated.importId), eq(csvImportRowsTable.status, "unmatched")));
    const matchedCount = await db.select().from(csvImportRowsTable)
      .where(and(eq(csvImportRowsTable.importId, updated.importId), eq(csvImportRowsTable.status, "matched")));

    await db.update(csvImportsTable).set({
      matchedRows: matchedCount.length,
      unmatchedRows: remainingUnmatched.length,
      status: remainingUnmatched.length === 0 ? "ready" : "needs_review",
    }).where(eq(csvImportsTable.id, updated.importId));
  }

  await writeAuditLog({
    action: "update",
    entityType: "csv_import_row",
    entityId: updated.id,
    field: "budgetLineId",
    oldValue: null,
    newValue: String(body.data.budgetLineId),
  });

  res.json(AssignImportRowResponse.parse(updated));
}));

router.post("/imports/:id/confirm", asyncHandler(async (req, res): Promise<void> => {
  const params = ConfirmImportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [imp] = await db.select().from(csvImportsTable).where(eq(csvImportsTable.id, params.data.id));
  if (!imp) {
    res.status(404).json({ error: "Import not found" });
    return;
  }

  if (imp.status === "confirmed") {
    res.json(ConfirmImportResponse.parse({
      importId: imp.id,
      created: 0,
      skippedDuplicate: imp.matchedRows,
      skippedUnmatched: imp.unmatchedRows,
    }));
    return;
  }

  const matchedRows = await db.select().from(csvImportRowsTable)
    .where(and(eq(csvImportRowsTable.importId, imp.id), eq(csvImportRowsTable.status, "matched")));

  const rowHashes = matchedRows
    .map(r => r.rowHash)
    .filter((h): h is string => !!h);

  const existingHashes = new Set<string>();
  if (rowHashes.length > 0) {
    const existingActuals = await db.select({ invoiceRef: monthlyActualsTable.invoiceRef })
      .from(monthlyActualsTable)
      .where(inArray(monthlyActualsTable.invoiceRef, rowHashes));
    for (const a of existingActuals) {
      if (a.invoiceRef) existingHashes.add(a.invoiceRef);
    }
  }

  let created = 0;
  let skippedDuplicate = 0;

  for (const row of matchedRows) {
    if (!row.budgetLineId || row.rawMonth == null || row.rawYear == null || row.rawAmount == null) {
      continue;
    }

    if (row.rowHash && existingHashes.has(row.rowHash)) {
      skippedDuplicate++;
      continue;
    }

    await db.insert(monthlyActualsTable).values({
      budgetLineId: row.budgetLineId,
      month: row.rawMonth,
      year: row.rawYear,
      actualAmount: row.rawAmount,
      invoiceRef: row.rowHash,
      importId: imp.id,
    });

    if (row.rowHash) {
      existingHashes.add(row.rowHash);
    }
    created++;
  }

  const unmatchedRows = await db.select().from(csvImportRowsTable)
    .where(and(eq(csvImportRowsTable.importId, imp.id), eq(csvImportRowsTable.status, "unmatched")));

  await db.update(csvImportsTable).set({ status: "confirmed" }).where(eq(csvImportsTable.id, imp.id));

  await writeAuditLog({
    action: "update",
    entityType: "csv_import",
    entityId: imp.id,
    field: "status",
    oldValue: imp.status,
    newValue: "confirmed",
  });

  res.json(ConfirmImportResponse.parse({
    importId: imp.id,
    created,
    skippedDuplicate,
    skippedUnmatched: unmatchedRows.length,
  }));
}));

router.delete("/imports/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = GetImportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [imp] = await db.select().from(csvImportsTable).where(eq(csvImportsTable.id, params.data.id));
  if (!imp) {
    res.status(404).json({ error: "Import not found" });
    return;
  }

  if (imp.status === "deleted") {
    res.status(400).json({ error: "Import already deleted" });
    return;
  }

  const previousStatus = imp.status;

  await db.transaction(async (tx) => {
    if (previousStatus === "confirmed") {
      await tx.delete(monthlyActualsTable).where(eq(monthlyActualsTable.importId, imp.id));

      const rows = await tx.select().from(csvImportRowsTable)
        .where(and(eq(csvImportRowsTable.importId, imp.id), eq(csvImportRowsTable.status, "matched")));
      const hashes = rows.map(r => r.rowHash).filter((h): h is string => !!h);
      if (hashes.length > 0) {
        await tx.delete(monthlyActualsTable).where(inArray(monthlyActualsTable.invoiceRef, hashes));
      }
    }

    await tx.delete(csvImportRowsTable).where(eq(csvImportRowsTable.importId, imp.id));

    await tx.update(csvImportsTable).set({
      status: "deleted",
      deletedAt: new Date(),
    }).where(eq(csvImportsTable.id, imp.id));
  });

  await writeAuditLog({
    action: "delete",
    entityType: "csv_import",
    entityId: imp.id,
    field: "status",
    oldValue: previousStatus,
    newValue: "deleted",
  });

  res.json({ success: true, id: imp.id, previousStatus });
}));

export default router;
