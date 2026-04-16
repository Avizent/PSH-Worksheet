import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, and, inArray, isNull } from "drizzle-orm";
import multer, { MulterError } from "multer";
import crypto from "crypto";
import XLSX from "xlsx";
import {
  db,
  budgetLinesTable,
  monthlyActualsTable,
  monthlyPlansTable,
  csvImportsTable,
  csvImportRowsTable,
  alertsTable,
  eventsTable,
  auditLogsTable,
  forecastVersionsTable,
  forecastPlansTable,
  shareTokensTable,
  boardSettingsTable,
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
  sep: 9, sept: 9, september: 9,
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

function isExcelFile(filename: string, mimetype: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (ext === "csv") return false;
  if (ext === "xlsx" || ext === "xls") return true;
  return (
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel"
  );
}

function parseExcelToRows(buffer: Buffer): { headers: string[]; dataRows: string[][] } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel file has no sheets");
  const sheet = workbook.Sheets[sheetName];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (raw.length < 2) throw new Error("Sheet must have a header row and at least one data row");
  const headers = raw[0].map((h: unknown) => String(h ?? ""));
  const dataRows = raw.slice(1)
    .filter((row: unknown[]) => row.some((cell: unknown) => String(cell ?? "").trim() !== ""))
    .map((row: unknown[]) => row.map((cell: unknown) => String(cell ?? "")));
  return { headers, dataRows };
}

function parseCsvToRows(content: string): { headers: string[]; dataRows: string[][] } {
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error("File must have a header row and at least one data row");
  const headers = parseCsvLine(lines[0]);
  const dataRows = lines.slice(1).map(line => parseCsvLine(line));
  return { headers, dataRows };
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

  const filename = file.originalname || "upload";
  const excel = isExcelFile(filename, file.mimetype);

  let parsedHeaders: string[];
  let dataRows: string[][];

  try {
    if (excel) {
      const result = parseExcelToRows(file.buffer);
      parsedHeaders = result.headers;
      dataRows = result.dataRows;
    } else {
      const csvContent = file.buffer.toString("utf-8");
      const result = parseCsvToRows(csvContent);
      parsedHeaders = result.headers;
      dataRows = result.dataRows;
    }
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed to parse file" });
    return;
  }

  if (dataRows.length === 0) {
    res.status(400).json({ error: "File must have at least one data row" });
    return;
  }

  const headers = parsedHeaders.map(h => normalise(h));
  const headersLower = parsedHeaders.map(h => h.toLowerCase().trim());

  const catIdx = headers.findIndex(h => ["category", "cat", "department", "dept", "costcentre", "vertical", "group", "team", "function", "segment"].includes(h));
  let lineItemIdx = headers.findIndex(h => ["lineitem", "line", "description", "item", "budgetitem", "budgetline", "name",
    "rowlabels", "rowlabel", "labels", "label",
    "activity", "marketingactivity", "budgetactivity", "initiative", "programme", "program",
    "campaign", "project", "task", "workstream", "expense", "expenseitem", "heading",
    "title", "spenditem", "costitem", "budgetdescription", "activityname"].includes(h));
  if (lineItemIdx === -1) lineItemIdx = (catIdx === 0 ? 1 : 0);
  const ownerIdx = headers.findIndex(h => ["owner", "budgetowner", "responsible", "manager", "lead", "assignee"].includes(h));
  const regionIdx = headers.findIndex(h => ["region", "geo", "geography", "market", "territory", "location", "country"].includes(h));
  const costStatusIdx = headers.findIndex(h => ["coststatus", "costtype", "fixedvariable", "type", "status", "expensetype"].includes(h));
  const boardApprovedIdx = headers.findIndex(h => ["boardapproved", "approvedbudget", "approved", "boardbudget", "annualbudget", "totalbudget", "fy26budget", "fy26", "annualplan", "yearlybudget"].includes(h));

  const monthIdx = headers.findIndex(h => h === "month" || h === "mon");
  const yearIdx = headers.findIndex(h => h === "year" || h === "yr");
  const amountIdx = headers.findIndex(h => ["amount", "actual", "actualamount", "spend", "cost", "total"].includes(h));
  const invoiceIdx = headers.findIndex(h => ["invoiceref", "invoice", "ref", "reference"].includes(h));

  const monthColumns: { monthNum: number; colIdx: number }[] = [];
  const planMonthColumns: { monthNum: number; colIdx: number }[] = [];
  const knownIdx = new Set([catIdx, lineItemIdx, ownerIdx, regionIdx, costStatusIdx, boardApprovedIdx, monthIdx, yearIdx, amountIdx, invoiceIdx].filter(i => i >= 0));

  for (let i = 0; i < headersLower.length; i++) {
    if (knownIdx.has(i)) continue;
    const raw = headersLower[i];
    for (const [name, num] of Object.entries(MONTH_MAP)) {
      if (raw.includes(name) || headers[i].startsWith(name)) {
        const isPlan = raw.includes("plan") || raw.includes("budget") || raw.includes("target") || raw.includes("forecast");
        if (isPlan) {
          planMonthColumns.push({ monthNum: num, colIdx: i });
        } else {
          monthColumns.push({ monthNum: num, colIdx: i });
        }
        break;
      }
    }
  }

  const isMatrixFormat = monthColumns.length >= 2 || planMonthColumns.length >= 2;

  if (!isMatrixFormat && amountIdx === -1) {
    const sampleHeaders = parsedHeaders.slice(0, 10).join(", ");
    res.status(400).json({
      error: `Could not detect format. Need either month columns (Jan, Feb...) or an 'Amount'/'Actual' column. Found headers: ${sampleHeaders}`,
    });
    return;
  }

  const budgetLines = await db.select().from(budgetLinesTable);
  const linesByNormName = new Map<string, typeof budgetLines[0]>();
  const linesByCatAndItem = new Map<string, typeof budgetLines[0]>();
  const autoCreatedLines = new Map<string, typeof budgetLines[0]>();

  for (const bl of budgetLines) {
    linesByNormName.set(normalise(bl.lineItem), bl);
    if (bl.category) {
      linesByCatAndItem.set(normalise(bl.category) + "|" + normalise(bl.lineItem), bl);
    }
  }

  type RowInsert = {
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
  };

  const rowInserts: RowInsert[] = [];
  let matched = 0;
  let unmatched = 0;
  let errors = 0;

  const currentYear = new Date().getFullYear();

  async function findOrCreateBudgetLine(rawCategory: string | null, rawLineItem: string | null, extraFields?: {
    owner?: string; region?: string; costStatus?: string; boardApproved?: number;
  }): Promise<typeof budgetLines[0] | undefined> {
    if (!rawLineItem) return undefined;

    let line: typeof budgetLines[0] | undefined;
    if (rawCategory && rawLineItem) {
      line = linesByCatAndItem.get(normalise(rawCategory) + "|" + normalise(rawLineItem));
    }
    if (!line) {
      line = linesByNormName.get(normalise(rawLineItem));
    }
    if (!line) {
      const autoKey = normalise(rawCategory || "Uncategorized") + "|" + normalise(rawLineItem);
      line = autoCreatedLines.get(autoKey);
      if (!line) {
        const [created] = await db.insert(budgetLinesTable).values({
          category: rawCategory || "Uncategorized",
          lineItem: rawLineItem,
          owner: extraFields?.owner || null,
          region: extraFields?.region || null,
          costStatus: extraFields?.costStatus || "Variable",
          boardApprovedAmount: extraFields?.boardApproved ?? null,
        }).returning();
        autoCreatedLines.set(autoKey, created);
        linesByNormName.set(normalise(created.lineItem), created);
        linesByCatAndItem.set(normalise(created.category) + "|" + normalise(created.lineItem), created);
        line = created;
      }
    }
    return line;
  }

  const [importRecord] = await db.insert(csvImportsTable).values({
    filename: filename,
    status: "pending",
    totalRows: dataRows.length,
  }).returning();

  if (isMatrixFormat) {
    const actualCols = monthColumns.length > 0 ? monthColumns : planMonthColumns;

    for (let i = 0; i < dataRows.length; i++) {
      const cols = dataRows[i];
      const rowIndex = i + 1;
      const rawCategory = catIdx >= 0 ? (cols[catIdx] || null) : null;
      const rawLineItem = lineItemIdx >= 0 ? (cols[lineItemIdx] || null) : null;

      if (!rawLineItem || !rawLineItem.trim()) continue;

      const rawOwner = ownerIdx >= 0 ? (cols[ownerIdx] || undefined) : undefined;
      const rawRegion = regionIdx >= 0 ? (cols[regionIdx] || undefined) : undefined;
      const rawCostStatus = costStatusIdx >= 0 ? (cols[costStatusIdx] || undefined) : undefined;
      const rawBoardApproved = boardApprovedIdx >= 0 ? parseFloat(String(cols[boardApprovedIdx] || "").replace(/[£$,]/g, "")) : undefined;

      const budgetLine = await findOrCreateBudgetLine(rawCategory, rawLineItem, {
        owner: rawOwner,
        region: rawRegion,
        costStatus: rawCostStatus,
        boardApproved: rawBoardApproved && !isNaN(rawBoardApproved) ? rawBoardApproved : undefined,
      });

      if (!budgetLine) {
        errors++;
        rowInserts.push({
          importId: importRecord.id, rowIndex, rawCategory, rawLineItem,
          rawMonth: null, rawYear: null, rawAmount: null, rawInvoiceRef: null,
          status: "error", budgetLineId: null, errorMessage: "Missing line item name", rowHash: null,
        });
        continue;
      }

      if (planMonthColumns.length > 0) {
        for (const mc of planMonthColumns) {
          const valStr = String(cols[mc.colIdx] || "").replace(/[£$,]/g, "");
          const val = parseFloat(valStr);
          if (isNaN(val)) continue;
          await db.insert(monthlyPlansTable).values({
            budgetLineId: budgetLine.id,
            month: mc.monthNum,
            year: currentYear,
            plannedAmount: val,
          });
        }
      }

      for (const mc of actualCols) {
        const valStr = String(cols[mc.colIdx] || "").replace(/[£$,]/g, "");
        const val = parseFloat(valStr);
        if (isNaN(val) || val === 0) continue;

        const rHash = hashRow(rawCategory || "", rawLineItem || "", mc.monthNum, currentYear, val, "");
        matched++;
        rowInserts.push({
          importId: importRecord.id, rowIndex, rawCategory, rawLineItem,
          rawMonth: mc.monthNum, rawYear: currentYear, rawAmount: val, rawInvoiceRef: null,
          status: "matched", budgetLineId: budgetLine.id, errorMessage: null, rowHash: rHash,
        });
      }
    }
  } else {
    for (let i = 0; i < dataRows.length; i++) {
      const cols = dataRows[i];
      const rowIndex = i + 1;
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
          importId: importRecord.id, rowIndex, rawCategory, rawLineItem,
          rawMonth, rawYear: rawYear && !isNaN(rawYear) ? rawYear : null,
          rawAmount: null, rawInvoiceRef,
          status: "error", budgetLineId: null, errorMessage: "Invalid or missing amount", rowHash: null,
        });
        continue;
      }

      if (rawMonth == null) {
        errors++;
        rowInserts.push({
          importId: importRecord.id, rowIndex, rawCategory, rawLineItem,
          rawMonth: null, rawYear: rawYear && !isNaN(rawYear) ? rawYear : null,
          rawAmount, rawInvoiceRef,
          status: "error", budgetLineId: null, errorMessage: "Invalid or missing month", rowHash: null,
        });
        continue;
      }

      const yearVal = rawYear && !isNaN(rawYear) ? rawYear : currentYear;
      const rHash = hashRow(rawCategory || "", rawLineItem || "", rawMonth, yearVal, rawAmount, rawInvoiceRef || "");

      const budgetLine = await findOrCreateBudgetLine(rawCategory, rawLineItem);

      if (budgetLine) {
        matched++;
        rowInserts.push({
          importId: importRecord.id, rowIndex, rawCategory, rawLineItem,
          rawMonth, rawYear: yearVal, rawAmount, rawInvoiceRef,
          status: "matched", budgetLineId: budgetLine.id, errorMessage: null, rowHash: rHash,
        });
      } else {
        unmatched++;
        rowInserts.push({
          importId: importRecord.id, rowIndex, rawCategory, rawLineItem,
          rawMonth, rawYear: yearVal, rawAmount, rawInvoiceRef,
          status: "unmatched", budgetLineId: null, errorMessage: null, rowHash: rHash,
        });
      }
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

  res.status(201).json({
    ...GetImportResponse.parse({
      ...updatedImport[0],
      rows: importRows,
    }),
    _debug: {
      detectedFormat: isMatrixFormat ? "matrix" : "transactional",
      headers: parsedHeaders,
      detectedColumns: {
        category: catIdx >= 0 ? parsedHeaders[catIdx] : null,
        lineItem: lineItemIdx >= 0 ? parsedHeaders[lineItemIdx] : "(fallback col 0)",
        owner: ownerIdx >= 0 ? parsedHeaders[ownerIdx] : null,
        region: regionIdx >= 0 ? parsedHeaders[regionIdx] : null,
        costStatus: costStatusIdx >= 0 ? parsedHeaders[costStatusIdx] : null,
        boardApproved: boardApprovedIdx >= 0 ? parsedHeaders[boardApprovedIdx] : null,
        monthCols: monthColumns.map(m => parsedHeaders[m.colIdx]),
        planCols: planMonthColumns.map(m => parsedHeaders[m.colIdx]),
      },
    },
  });
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

  if (imp.status === "deleted") {
    res.status(400).json({ error: "Cannot confirm a deleted import" });
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
      await tx.delete(monthlyActualsTable)
        .where(eq(monthlyActualsTable.importId, imp.id));

      const importRows = await tx.select({ rowHash: csvImportRowsTable.rowHash })
        .from(csvImportRowsTable)
        .where(and(
          eq(csvImportRowsTable.importId, imp.id),
          eq(csvImportRowsTable.status, "matched"),
        ));

      const hashes = importRows
        .map(r => r.rowHash)
        .filter((h): h is string => !!h);

      if (hashes.length > 0) {
        await tx.delete(monthlyActualsTable)
          .where(and(
            inArray(monthlyActualsTable.invoiceRef, hashes),
            isNull(monthlyActualsTable.importId),
          ));
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

router.post("/imports/clear-all", asyncHandler(async (_req, res): Promise<void> => {
  await db.transaction(async (tx) => {
    const d = {
      forecastPlans: (await tx.delete(forecastPlansTable).returning()).length,
      forecastVersions: (await tx.delete(forecastVersionsTable).returning()).length,
      actuals: (await tx.delete(monthlyActualsTable).returning()).length,
      importRows: (await tx.delete(csvImportRowsTable).returning()).length,
      imports: (await tx.delete(csvImportsTable).returning()).length,
      alerts: (await tx.delete(alertsTable).returning()).length,
      events: (await tx.delete(eventsTable).returning()).length,
      shareTokens: (await tx.delete(shareTokensTable).returning()).length,
      boardSettings: (await tx.delete(boardSettingsTable).returning()).length,
      auditLogs: (await tx.delete(auditLogsTable).returning()).length,
      monthlyPlans: (await tx.delete(monthlyPlansTable).returning()).length,
      budgetLines: (await tx.delete(budgetLinesTable).returning()).length,
    };

    res.json({ success: true, cleared: d });
  });
}));

export default router;
