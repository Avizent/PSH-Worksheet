import { Router, type IRouter } from "express";
import { eq, inArray, asc } from "drizzle-orm";
import multer from "multer";
import XLSX from "xlsx";
import JSZip from "jszip";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  budgetLineColumnsTable,
} from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { logger } from "../lib/logger";
import { createSnapshot } from "./snapshots";
import { triggerAlertEvaluation } from "../lib/runAlertEvaluation";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router: IRouter = Router();

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The 9 fixed base headers that appear in every export, in this exact order.
// These cannot be renamed or reordered (would require a programming change).
const BASE_HEADERS_LEFT = [
  "Category",
  "Subcategory",
  "Line Item",
  "Owner",
  "Region",
  "Channel",
  "Cost Status",
  "Projection %",
  "Board Approved Amount",
] as const;

// 24 fixed monthly headers
const MONTH_HEADERS = [
  ...MONTH_LABELS.map((m) => `${m} Plan`),
  ...MONTH_LABELS.map((m) => `${m} Actual`),
];

const RESERVED_HEADER_SET = new Set<string>([...BASE_HEADERS_LEFT, ...MONTH_HEADERS]);

function formatCurrency(val: number): string {
  return val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

router.get("/excel/export", asyncHandler(async (_req, res): Promise<void> => {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Budget Lines");

  const [budgetLines, plans, actuals, customCols] = await Promise.all([
    db.select().from(budgetLinesTable).orderBy(budgetLinesTable.category, budgetLinesTable.lineItem),
    db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, 2026)),
    db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, 2026)),
    db.select().from(budgetLineColumnsTable).orderBy(asc(budgetLineColumnsTable.sortOrder), asc(budgetLineColumnsTable.id)),
  ]);
  const currentMonth = new Date().getMonth() + 1;

  // Header row matches the import format exactly:
  //   <BASE_HEADERS_LEFT> ... <custom columns in sortOrder> ... <Jan Plan ... Dec Actual>
  // Then export-only computed columns are appended at the far right.
  const headerRow: string[] = [
    ...BASE_HEADERS_LEFT,
    ...customCols.map((c) => c.name),
    ...MONTH_HEADERS,
    // Export-only computed columns (ignored on import)
    ...MONTH_LABELS.map((ml) => `${ml} Projected`),
    "Total Plan",
    "Total Actual",
    "Total Projected",
    "Variance (Actual)",
    "Variance (Projected)",
  ];

  sheet.addRow(headerRow);
  const hRow = sheet.getRow(1);
  hRow.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  hRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1e3a5f" } };
  hRow.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const bl of budgetLines) {
    const blPlans = plans.filter((p) => p.budgetLineId === bl.id);
    const blActuals = actuals.filter((a) => a.budgetLineId === bl.id);
    const planMap = new Map(blPlans.map((p) => [p.month, Number(p.plannedAmount)]));
    const actualMap = new Map(blActuals.map((a) => [a.month, Number(a.actualAmount)]));

    let lastActual: number | null = null;
    for (let m = 1; m <= 12; m++) {
      if (actualMap.has(m)) lastActual = actualMap.get(m)!;
    }

    const row: (string | number | null)[] = [
      bl.category,
      bl.subcategory || "",
      bl.lineItem,
      bl.owner || "",
      bl.region || "",
      bl.channel || "",
      bl.costStatus,
      bl.projectionPct || 0,
      bl.boardApprovedAmount ?? "",
    ];

    // Custom column values
    const cf = (bl.customFields ?? {}) as Record<string, string | number | null>;
    for (const col of customCols) {
      const v = cf[col.name];
      if (v === null || v === undefined || v === "") {
        row.push("");
      } else if (col.type === "number") {
        const n = typeof v === "number" ? v : Number(v);
        row.push(isFinite(n) ? n : "");
      } else {
        row.push(String(v));
      }
    }

    // Monthly plan + actual
    let totalPlan = 0;
    let totalActual = 0;
    const planVals: number[] = [];
    const actualVals: number[] = [];
    for (let m = 1; m <= 12; m++) {
      const pv = planMap.get(m) || 0;
      const av = actualMap.get(m) || 0;
      totalPlan += pv;
      totalActual += av;
      planVals.push(pv);
      actualVals.push(av);
    }
    row.push(...planVals, ...actualVals);

    // Export-only computed columns
    let totalProjected = 0;
    const projectedVals: number[] = [];
    for (let m = 1; m <= 12; m++) {
      const av = actualMap.get(m) || 0;
      let proj = 0;
      if (bl.costStatus === "Fixed Cost" && m > currentMonth && lastActual !== null) {
        proj = lastActual * (1 + (bl.projectionPct || 0) / 100);
      } else if (actualMap.has(m)) {
        proj = av;
      }
      totalProjected += proj;
      projectedVals.push(proj);
    }
    row.push(...projectedVals, totalPlan, totalActual, totalProjected, totalActual - totalPlan, totalProjected - totalPlan);

    sheet.addRow(row);
  }

  // Column widths and formats. Index ranges:
  //   1..9     base headers (left)
  //   10..(9+customCols.length)   custom columns
  //   next 24  monthly plan/actual
  //   trailing 17 export-only computed (12 projected + 5 totals/variances)
  const customStart = BASE_HEADERS_LEFT.length + 1; // 1-indexed
  const customEnd = customStart + customCols.length - 1;
  const monthlyStart = customEnd + 1;
  const monthlyEnd = monthlyStart + MONTH_HEADERS.length - 1;

  sheet.columns.forEach((col, i) => {
    const colNum = i + 1;
    if (colNum <= BASE_HEADERS_LEFT.length) {
      // Base headers — text-ish; Projection % is %, Board Approved Amount is currency
      col.width = 18;
      if (headerRow[i] === "Projection %") {
        col.width = 12;
        col.numFmt = "0.0";
      } else if (headerRow[i] === "Board Approved Amount") {
        col.numFmt = "£#,##0";
      }
    } else if (colNum >= customStart && colNum <= customEnd) {
      const def = customCols[colNum - customStart];
      col.width = Math.max(14, Math.min(28, def.name.length + 4));
      if (def.type === "number") col.numFmt = "£#,##0";
    } else if (colNum >= monthlyStart && colNum <= monthlyEnd) {
      col.width = 11;
      col.numFmt = "£#,##0";
    } else {
      // Export-only computed columns
      col.width = 13;
      col.numFmt = "£#,##0";
    }
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `budget_export_${today}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}));

// ─── Shared validation helpers ─────────────────────────────────────────────────

interface ValidationError {
  column: string;
  row: number;
  message: string;
}

interface ParsedRow {
  category: string;
  subcategory: string;
  lineItem: string;
  owner: string;
  region: string;
  channel: string;
  costStatus: string;
  projectionPct: number;
  boardApprovedAmount: number | null;
  plans: number[];
  actuals: number[];
  customFields: Record<string, string | number | null>;
}

interface UnknownColumn {
  name: string;
  columnIndex: number; // 1-based position in the source sheet
}

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function cellToNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "string") return null;
  const n = Number(val);
  if (!isFinite(n)) return null;
  return n;
}

/**
 * Pre-flight check: returns sheet names from the workbook, or an error if the
 * file is not a valid / safe .xlsx.
 */
async function inspectWorkbook(buf: Buffer): Promise<
  | { ok: true; workbook: XLSX.WorkBook; sheetNames: string[] }
  | { ok: false; errors: ValidationError[] }
> {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    return {
      ok: false,
      errors: [{ column: "file", row: 0, message: "File must be a valid .xlsx file. CSV and .xls (Excel 97-2003) files are not supported — please save as .xlsx first." }],
    };
  }

  try {
    const zip = await JSZip.loadAsync(buf);
    if (zip.file("xl/vbaProject.bin")) {
      return {
        ok: false,
        errors: [{ column: "file", row: 0, message: "Macro-enabled workbooks (.xlsm) are not accepted. Please save as .xlsx (no macros) and try again." }],
      };
    }
  } catch {
    return {
      ok: false,
      errors: [{ column: "file", row: 0, message: "Could not inspect file contents. Make sure the file is a valid .xlsx workbook." }],
    };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buf, { type: "buffer", cellDates: true });
  } catch {
    return {
      ok: false,
      errors: [{ column: "file", row: 0, message: "Could not parse file as .xlsx. The file may be corrupted." }],
    };
  }

  return { ok: true, workbook, sheetNames: workbook.SheetNames };
}

interface KnownCustomColumn {
  name: string;
  type: string;
}

async function validateBuffer(
  buf: Buffer,
  sheetName: string | undefined,
  knownCustomColumns: KnownCustomColumn[]
): Promise<
  | { valid: true; parsed: ParsedRow[]; unknownColumns: UnknownColumn[]; recognisedCustomColumns: string[] }
  | { valid: false; errors: ValidationError[] }
> {
  const inspection = await inspectWorkbook(buf);
  if (!inspection.ok) {
    return { valid: false, errors: inspection.errors };
  }

  const { workbook, sheetNames } = inspection;
  const target = sheetName ?? "Budget Lines";

  if (!sheetNames.includes(target)) {
    return {
      valid: false,
      errors: [{
        column: "sheet",
        row: 0,
        message: sheetName
          ? `Sheet "${sheetName}" not found. Available sheets: ${sheetNames.join(", ")}`
          : `Sheet named exactly "Budget Lines" not found. Found: ${sheetNames.join(", ")}`,
      }],
    };
  }

  const sheet = workbook.Sheets[target];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length < 1) {
    return { valid: false, errors: [{ column: "file", row: 0, message: "Sheet is empty" }] };
  }

  const headerRow = (rows[0] as unknown[]).map((h) => cellToString(h));

  // Validate the 9 LEFT base headers in their fixed positions (cannot be renamed)
  const headerErrors: ValidationError[] = [];
  BASE_HEADERS_LEFT.forEach((expected, i) => {
    if (headerRow[i] !== expected) {
      headerErrors.push({
        column: expected,
        row: 1,
        message: `Column ${i + 1}: expected "${expected}", got "${headerRow[i] ?? ""}"`,
      });
    }
  });
  if (headerErrors.length > 0) {
    return { valid: false, errors: headerErrors };
  }

  // The 24 monthly headers must be present somewhere after the base headers,
  // in their canonical Jan Plan ... Dec Actual order. Find the start position.
  let monthStart = -1;
  for (let i = BASE_HEADERS_LEFT.length; i + MONTH_HEADERS.length <= headerRow.length; i++) {
    let match = true;
    for (let j = 0; j < MONTH_HEADERS.length; j++) {
      if (headerRow[i + j] !== MONTH_HEADERS[j]) { match = false; break; }
    }
    if (match) { monthStart = i; break; }
  }
  if (monthStart === -1) {
    return {
      valid: false,
      errors: [{
        column: "header",
        row: 1,
        message: `Could not find the monthly header block "Jan Plan" through "Dec Actual" in order. The 12 monthly Plan and 12 monthly Actual columns must appear together, in the standard order, somewhere after column ${BASE_HEADERS_LEFT.length}.`,
      }],
    };
  }
  const monthEnd = monthStart + MONTH_HEADERS.length - 1; // inclusive

  // Anything between BASE_HEADERS_LEFT and monthStart is a candidate custom column header.
  const knownCustomByName = new Map(knownCustomColumns.map((c) => [c.name, c]));
  const recognisedCustomColumns: string[] = [];
  const unknownColumns: UnknownColumn[] = [];
  // Each custom column entry: { name, type, sheetIndex } (zero-based)
  const customColMap: { name: string; type: string; sheetIndex: number }[] = [];
  const customColUnknown: { name: string; sheetIndex: number }[] = [];
  for (let i = BASE_HEADERS_LEFT.length; i < monthStart; i++) {
    const h = headerRow[i];
    if (!h) {
      // Empty header in the custom-column zone — skip silently
      continue;
    }
    if (RESERVED_HEADER_SET.has(h)) {
      // Reserved name appearing where it shouldn't be — surface as an error
      return {
        valid: false,
        errors: [{
          column: h,
          row: 1,
          message: `Header "${h}" is reserved for the fixed columns and cannot appear here (column ${i + 1}).`,
        }],
      };
    }
    const known = knownCustomByName.get(h);
    if (known) {
      customColMap.push({ name: known.name, type: known.type, sheetIndex: i });
      recognisedCustomColumns.push(known.name);
    } else {
      customColUnknown.push({ name: h, sheetIndex: i });
      unknownColumns.push({ name: h, columnIndex: i + 1 });
    }
  }

  // Anything after the monthly block that isn't a known export-only computed
  // column is also an unknown column (e.g. user added something to the right).
  const EXPORT_ONLY_HEADERS = new Set<string>([
    ...MONTH_LABELS.map((m) => `${m} Projected`),
    "Total Plan",
    "Total Actual",
    "Total Projected",
    "Variance (Actual)",
    "Variance (Projected)",
  ]);
  for (let i = monthEnd + 1; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (!h) continue;
    if (EXPORT_ONLY_HEADERS.has(h)) continue; // ignored on import
    if (RESERVED_HEADER_SET.has(h)) {
      return {
        valid: false,
        errors: [{
          column: h,
          row: 1,
          message: `Header "${h}" is reserved for the fixed columns and cannot appear here (column ${i + 1}).`,
        }],
      };
    }
    const known = knownCustomByName.get(h);
    if (known) {
      customColMap.push({ name: known.name, type: known.type, sheetIndex: i });
      recognisedCustomColumns.push(known.name);
    } else {
      customColUnknown.push({ name: h, sheetIndex: i });
      unknownColumns.push({ name: h, columnIndex: i + 1 });
    }
  }

  const dataRows = rows.slice(1).filter((r) => (r as unknown[]).some((c) => cellToString(c) !== ""));
  if (dataRows.length === 0) {
    return { valid: false, errors: [{ column: "file", row: 0, message: "No data rows found (rows 2+ are all empty)" }] };
  }

  const errors: ValidationError[] = [];
  const parsed: ParsedRow[] = [];

  dataRows.forEach((rawRow, i) => {
    const r = rawRow as unknown[];
    const rowNum = i + 2;

    const category = cellToString(r[0]);
    const subcategory = cellToString(r[1]);
    const lineItem = cellToString(r[2]);
    const owner = cellToString(r[3]);
    const region = cellToString(r[4]);
    const channel = cellToString(r[5]);
    const costStatus = cellToString(r[6]);
    const projRaw = r[7];
    const boardRaw = r[8];

    if (!category) errors.push({ column: "Category", row: rowNum, message: "Category must not be empty" });
    if (!lineItem) errors.push({ column: "Line Item", row: rowNum, message: "Line Item must not be empty" });
    if (costStatus !== "Variable" && costStatus !== "Fixed Cost") {
      errors.push({
        column: "Cost Status",
        row: rowNum,
        message: `Cost Status must be exactly "Variable" or "Fixed Cost", got "${costStatus}"`,
      });
    }

    let projectionPct = 0;
    if (projRaw !== "" && projRaw !== null && projRaw !== undefined) {
      const n = cellToNumber(projRaw);
      if (n === null) {
        errors.push({ column: "Projection %", row: rowNum, message: "Projection % must be a number" });
      } else if (n < 0 || n > 100) {
        errors.push({ column: "Projection %", row: rowNum, message: `Projection % must be 0–100, got ${n}` });
      } else {
        projectionPct = n;
      }
    }

    let boardApprovedAmount: number | null = null;
    if (boardRaw !== "" && boardRaw !== null && boardRaw !== undefined) {
      const n = cellToNumber(boardRaw);
      if (n === null) {
        errors.push({ column: "Board Approved Amount", row: rowNum, message: "Board Approved Amount must be a number" });
      } else {
        boardApprovedAmount = n;
      }
    }

    const plans: number[] = [];
    for (let m = 0; m < 12; m++) {
      const v = r[monthStart + m];
      if (v !== "" && v !== null && v !== undefined) {
        const n = cellToNumber(v);
        if (n === null) {
          errors.push({ column: `${MONTH_LABELS[m]} Plan`, row: rowNum, message: `${MONTH_LABELS[m]} Plan must be a number` });
          plans.push(0);
        } else {
          plans.push(n);
        }
      } else {
        plans.push(0);
      }
    }

    const actuals: number[] = [];
    for (let m = 0; m < 12; m++) {
      const v = r[monthStart + 12 + m];
      if (v !== "" && v !== null && v !== undefined) {
        const n = cellToNumber(v);
        if (n === null) {
          errors.push({ column: `${MONTH_LABELS[m]} Actual`, row: rowNum, message: `${MONTH_LABELS[m]} Actual must be a number` });
          actuals.push(0);
        } else {
          actuals.push(n);
        }
      } else {
        actuals.push(0);
      }
    }

    // Custom field values — known columns only. Unknown columns are tracked
    // separately via `unknownColumns` and only attach to the row if/when the
    // user accepts them at import time (handled in /excel/import).
    const customFields: Record<string, string | number | null> = {};
    for (const col of customColMap) {
      const v = r[col.sheetIndex];
      if (v === "" || v === null || v === undefined) continue;
      if (col.type === "number") {
        const n = cellToNumber(v);
        if (n === null) {
          errors.push({ column: col.name, row: rowNum, message: `Custom column "${col.name}" must be a number` });
        } else {
          customFields[col.name] = n;
        }
      } else {
        customFields[col.name] = cellToString(v);
      }
    }
    // Stash the raw values for unknown columns on the row (under their
    // sheet header name) so import can write them through if accepted.
    for (const u of customColUnknown) {
      const v = r[u.sheetIndex];
      if (v === "" || v === null || v === undefined) continue;
      // Stored as-is; import will coerce based on the accepted type.
      customFields[u.name] = typeof v === "number" ? v : cellToString(v);
    }

    parsed.push({ category, subcategory, lineItem, owner, region, channel, costStatus, projectionPct, boardApprovedAmount, plans, actuals, customFields });
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, parsed, unknownColumns, recognisedCustomColumns };
}

// ─── Validate (dry run — no DB writes) ────────────────────────────────────────

router.post(
  "/excel/validate",
  upload.single("file"),
  asyncHandler(async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ valid: false, errors: [{ column: "file", row: 0, message: "No file uploaded" }] });
      return;
    }

    const requestedSheet = typeof req.body.sheetName === "string" && req.body.sheetName.trim()
      ? req.body.sheetName.trim()
      : undefined;

    if (!requestedSheet) {
      const inspection = await inspectWorkbook(req.file.buffer);
      if (!inspection.ok) {
        res.status(422).json({ valid: false, errors: inspection.errors });
        return;
      }
      const { sheetNames } = inspection;

      if (sheetNames.length > 1) {
        res.json({ needsSheetSelection: true, sheetNames });
        return;
      }
    }

    const knownCustomColumns = await db
      .select({ name: budgetLineColumnsTable.name, type: budgetLineColumnsTable.type })
      .from(budgetLineColumnsTable);

    const result = await validateBuffer(req.file.buffer, requestedSheet, knownCustomColumns);
    if (!result.valid) {
      res.status(422).json(result);
      return;
    }

    const existingLines = await db.select().from(budgetLinesTable);
    const existingKeys = new Set(existingLines.map((l) => `${l.category}||${l.lineItem}`));
    const incomingKeys = new Set(result.parsed.map((p) => `${p.category}||${p.lineItem}`));

    const toAdd = result.parsed
      .filter((p) => !existingKeys.has(`${p.category}||${p.lineItem}`))
      .map((p) => ({ category: p.category, lineItem: p.lineItem }));
    const toUpdate = result.parsed
      .filter((p) => existingKeys.has(`${p.category}||${p.lineItem}`))
      .map((p) => ({ category: p.category, lineItem: p.lineItem }));
    const toDelete = existingLines
      .filter((l) => !incomingKeys.has(`${l.category}||${l.lineItem}`))
      .map((l) => ({ category: l.category, lineItem: l.lineItem }));

    res.json({
      valid: true,
      rowCount: result.parsed.length,
      diff: { toAdd, toUpdate, toDelete },
      unknownColumns: result.unknownColumns,
      recognisedCustomColumns: result.recognisedCustomColumns,
    });
  })
);

// ─── Import (validate + DB writes) ────────────────────────────────────────────

router.post(
  "/excel/import",
  upload.single("file"),
  asyncHandler(async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const requestedSheet = typeof req.body.sheetName === "string" && req.body.sheetName.trim()
      ? req.body.sheetName.trim()
      : undefined;

    // Per-row decision payloads sent in by the import UI.
    //   acceptedNewRows:    [{ category, lineItem }]   — unknown rows the user opted to add
    //   acceptedNewColumns: [{ name, type }]           — unknown columns the user opted to keep
    // Anything not listed here is excluded (default deny).
    let acceptedNewRows: { category: string; lineItem: string }[] = [];
    let acceptedNewColumns: { name: string; type: string }[] = [];
    try {
      if (typeof req.body.acceptedNewRows === "string" && req.body.acceptedNewRows.trim()) {
        acceptedNewRows = JSON.parse(req.body.acceptedNewRows);
      }
      if (typeof req.body.acceptedNewColumns === "string" && req.body.acceptedNewColumns.trim()) {
        acceptedNewColumns = JSON.parse(req.body.acceptedNewColumns);
      }
    } catch {
      res.status(400).json({ error: "Invalid acceptedNewRows or acceptedNewColumns JSON" });
      return;
    }

    const acceptedNewRowKeys = new Set(
      acceptedNewRows.map((r) => `${r.category}||${r.lineItem}`)
    );
    const acceptedNewColumnsByName = new Map(
      acceptedNewColumns
        .filter((c) => c && typeof c.name === "string" && (c.type === "text" || c.type === "number"))
        .map((c) => [c.name, c.type])
    );

    // Known custom columns from the DB plus the user-approved new ones.
    // The new ones are NOT persisted yet — we only insert them after the
    // workbook validates, to avoid leaving orphan column definitions on a
    // failed import.
    const existingCustomCols = await db
      .select()
      .from(budgetLineColumnsTable)
      .orderBy(asc(budgetLineColumnsTable.sortOrder), asc(budgetLineColumnsTable.id));
    const existingCustomColNames = new Set(existingCustomCols.map((c) => c.name));

    const newColsToCreate = acceptedNewColumns.filter(
      (c) => c && c.name && !existingCustomColNames.has(c.name) && (c.type === "text" || c.type === "number")
    );

    const knownCustomColumns = [
      ...existingCustomCols.map((c) => ({ name: c.name, type: c.type })),
      ...newColsToCreate.map((c) => ({ name: c.name, type: c.type })),
    ];

    const validation = await validateBuffer(req.file.buffer, requestedSheet, knownCustomColumns);
    if (!validation.valid) {
      res.status(422).json(validation);
      return;
    }

    const { parsed, unknownColumns } = validation;

    // Block the import if there are unknown columns the user did not approve.
    const stillUnknownColumns = unknownColumns.filter((u) => !acceptedNewColumnsByName.has(u.name));
    if (stillUnknownColumns.length > 0) {
      res.status(409).json({
        error: "Unknown columns require explicit accept/reject decisions",
        unknownColumns: stillUnknownColumns,
      });
      return;
    }

    // Validation passed — now persist the newly-accepted custom columns.
    let nextSortOrder =
      existingCustomCols.reduce((max, c) => Math.max(max, c.sortOrder ?? 0), 0) + 1;
    const newlyCreatedColumns: { name: string; type: string }[] = [];
    for (const c of newColsToCreate) {
      await db.insert(budgetLineColumnsTable).values({
        name: c.name,
        type: c.type,
        sortOrder: nextSortOrder++,
      });
      newlyCreatedColumns.push({ name: c.name, type: c.type });
    }

    let snapshotSaved = false;
    try {
      await createSnapshot("pre-import");
      snapshotSaved = true;
    } catch (e) {
      logger.warn({ err: e }, "Pre-import snapshot failed (non-fatal)");
    }

    const existingLines = await db.select().from(budgetLinesTable);
    const existingMap = new Map(existingLines.map((l) => [`${l.category}||${l.lineItem}`, l]));

    // Split parsed rows into "matches existing" and "new". Default-deny new rows.
    const skippedNewRows: { category: string; lineItem: string }[] = [];
    const acceptedRows: ParsedRow[] = [];
    for (const p of parsed) {
      const key = `${p.category}||${p.lineItem}`;
      if (existingMap.has(key)) {
        acceptedRows.push(p);
      } else if (acceptedNewRowKeys.has(key)) {
        acceptedRows.push(p);
      } else {
        skippedNewRows.push({ category: p.category, lineItem: p.lineItem });
      }
    }

    // Deletes are based on the *accepted* set so unconfirmed new rows don't
    // accidentally cause existing rows to be dropped.
    const acceptedKeys = new Set(acceptedRows.map((p) => `${p.category}||${p.lineItem}`));
    // Existing lines that don't appear in the file at all → candidates for delete.
    // A line is only deleted when it appears nowhere in the file (parsed); rows
    // the user rejected adding don't keep "their" existing line alive (they
    // didn't have one). So this is just: existing not in file.
    const fileKeys = new Set(parsed.map((p) => `${p.category}||${p.lineItem}`));
    const toDelete = existingLines.filter((l) => !fileKeys.has(`${l.category}||${l.lineItem}`));
    if (toDelete.length > 0) {
      await db.delete(budgetLinesTable).where(
        inArray(budgetLinesTable.id, toDelete.map((l) => l.id))
      );
    }

    let upserted = 0;
    let inserted = 0;
    let plansWritten = 0;
    let actualsWritten = 0;

    // Resolved type map for every custom column we'll write (existing + new)
    const customColTypeByName = new Map<string, string>();
    for (const c of knownCustomColumns) customColTypeByName.set(c.name, c.type);

    for (const row of acceptedRows) {
      const key = `${row.category}||${row.lineItem}`;
      const existing = existingMap.get(key);

      // Coerce custom field values to declared types; drop unknown names defensively
      const cf: Record<string, string | number | null> = {};
      for (const [name, raw] of Object.entries(row.customFields)) {
        const t = customColTypeByName.get(name);
        if (!t) continue;
        if (raw === null || raw === undefined || raw === "") continue;
        if (t === "number") {
          const n = typeof raw === "number" ? raw : Number(raw);
          if (isFinite(n)) cf[name] = n;
        } else {
          cf[name] = String(raw);
        }
      }

      let lineId: number;

      if (existing) {
        await db
          .update(budgetLinesTable)
          .set({
            subcategory: row.subcategory || null,
            owner: row.owner || null,
            region: row.region || null,
            channel: row.channel || null,
            costStatus: row.costStatus,
            projectionPct: row.projectionPct,
            boardApprovedAmount: row.boardApprovedAmount,
            customFields: cf,
          })
          .where(eq(budgetLinesTable.id, existing.id));
        lineId = existing.id;
        upserted++;
      } else {
        const [newLine] = await db
          .insert(budgetLinesTable)
          .values({
            category: row.category,
            subcategory: row.subcategory || null,
            lineItem: row.lineItem,
            owner: row.owner || null,
            region: row.region || null,
            channel: row.channel || null,
            costStatus: row.costStatus,
            projectionPct: row.projectionPct,
            boardApprovedAmount: row.boardApprovedAmount,
            customFields: cf,
          })
          .returning();
        lineId = newLine.id;
        inserted++;
      }

      await db.delete(monthlyPlansTable).where(eq(monthlyPlansTable.budgetLineId, lineId));
      const planValues = row.plans
        .map((amount, idx) => ({ budgetLineId: lineId, month: idx + 1, year: 2026, plannedAmount: amount }))
        .filter((p) => p.plannedAmount !== 0);
      if (planValues.length > 0) {
        await db.insert(monthlyPlansTable).values(planValues);
        plansWritten += planValues.length;
      }

      await db.delete(monthlyActualsTable).where(eq(monthlyActualsTable.budgetLineId, lineId));
      const actualValues = row.actuals
        .map((amount, idx) => ({ budgetLineId: lineId, month: idx + 1, year: 2026, actualAmount: amount }))
        .filter((a) => a.actualAmount !== 0);
      if (actualValues.length > 0) {
        await db.insert(monthlyActualsTable).values(actualValues);
        actualsWritten += actualValues.length;
      }
    }

    triggerAlertEvaluation();
    res.json({
      valid: true,
      message: "Budget imported successfully.",
      snapshotSaved,
      counts: {
        upserted,
        inserted,
        deleted: toDelete.length,
        plansWritten,
        actualsWritten,
        skippedNewRows: skippedNewRows.length,
        newColumnsCreated: newlyCreatedColumns.length,
      },
      skippedNewRows,
      newColumnsCreated: newlyCreatedColumns,
    });
  })
);

export default router;
