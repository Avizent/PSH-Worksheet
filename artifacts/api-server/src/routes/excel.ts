import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import multer from "multer";
import XLSX from "xlsx";
import JSZip from "jszip";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
} from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { logger } from "../lib/logger";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router: IRouter = Router();

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const EXPECTED_HEADERS = [
  "Category",
  "Subcategory",
  "Line Item",
  "Owner",
  "Region",
  "Channel",
  "Cost Status",
  "Projection %",
  "Board Approved Amount",
  ...MONTH_LABELS.map((m) => `${m} Plan`),
  ...MONTH_LABELS.map((m) => `${m} Actual`),
];

// ─── Export ───────────────────────────────────────────────────────────────────

router.get("/excel/export", asyncHandler(async (_req, res): Promise<void> => {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Budget Lines");

  const budgetLines = await db
    .select()
    .from(budgetLinesTable)
    .orderBy(budgetLinesTable.category, budgetLinesTable.lineItem);
  const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, 2026));
  const actuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, 2026));

  sheet.addRow(EXPECTED_HEADERS);
  const hRow = sheet.getRow(1);
  hRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1e3a5f" } };
  hRow.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const bl of budgetLines) {
    const planMap = new Map(
      plans.filter((p) => p.budgetLineId === bl.id).map((p) => [p.month, Number(p.plannedAmount)])
    );
    const actualMap = new Map(
      actuals.filter((a) => a.budgetLineId === bl.id).map((a) => [a.month, Number(a.actualAmount)])
    );

    const row: (string | number | null)[] = [
      bl.category,
      bl.subcategory ?? "",
      bl.lineItem,
      bl.owner ?? "",
      bl.region ?? "",
      bl.channel ?? "",
      bl.costStatus,
      bl.projectionPct ?? 0,
      bl.boardApprovedAmount ?? null,
    ];

    for (let m = 1; m <= 12; m++) row.push(planMap.get(m) ?? 0);
    for (let m = 1; m <= 12; m++) row.push(actualMap.get(m) ?? 0);

    sheet.addRow(row);
  }

  sheet.columns.forEach((col, i) => {
    const colNum = i + 1;
    if (colNum <= 7) {
      // Metadata text columns (1-7): Category through Cost Status
      col.width = 18;
    } else if (colNum === 8) {
      // Projection % — raw 0-100 integer, formatted as "0.0" (not %)
      col.width = 12;
      col.numFmt = "0.0";
    } else if (colNum === 9) {
      // Board Approved Amount — currency format
      col.width = 18;
      col.numFmt = "£#,##0";
    } else {
      // Monthly plan and actual columns (10-33) — currency format
      col.width = 11;
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
}

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function cellToNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  // Reject string cells — cells must be numeric type, not text-formatted numbers
  if (typeof val === "string") return null;
  const n = Number(val);
  if (!isFinite(n)) return null;
  return n;
}

async function validateBuffer(buf: Buffer): Promise<
  | { valid: true; parsed: ParsedRow[] }
  | { valid: false; errors: ValidationError[] }
> {
  // Must be ZIP (xlsx magic bytes: PK)
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    return {
      valid: false,
      errors: [{ column: "file", row: 0, message: "File must be a valid .xlsx file. CSV and .xls (Excel 97-2003) files are not supported — please save as .xlsx first." }],
    };
  }

  // Reject .xlsm: check ZIP for xl/vbaProject.bin (macro-enabled workbook)
  try {
    const zip = await JSZip.loadAsync(buf);
    if (zip.file("xl/vbaProject.bin")) {
      return {
        valid: false,
        errors: [{ column: "file", row: 0, message: "Macro-enabled workbooks (.xlsm) are not accepted. Please save as .xlsx (no macros) and try again." }],
      };
    }
  } catch {
    return {
      valid: false,
      errors: [{ column: "file", row: 0, message: "Could not inspect file contents. Make sure the file is a valid .xlsx workbook." }],
    };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buf, { type: "buffer", cellDates: true });
  } catch {
    return {
      valid: false,
      errors: [{ column: "file", row: 0, message: "Could not parse file as .xlsx. The file may be corrupted." }],
    };
  }

  if (!workbook.SheetNames.includes("Budget Lines")) {
    return {
      valid: false,
      errors: [{ column: "sheet", row: 0, message: `Sheet named exactly "Budget Lines" not found. Found: ${workbook.SheetNames.join(", ")}` }],
    };
  }

  const sheet = workbook.Sheets["Budget Lines"];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length < 1) {
    return { valid: false, errors: [{ column: "file", row: 0, message: "Sheet is empty" }] };
  }

  // Validate headers
  const headerRow = (rows[0] as unknown[]).map((h) => cellToString(h));
  const headerErrors: ValidationError[] = [];
  EXPECTED_HEADERS.forEach((expected, i) => {
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
      const v = r[9 + m];
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
      const v = r[21 + m];
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

    parsed.push({ category, subcategory, lineItem, owner, region, channel, costStatus, projectionPct, boardApprovedAmount, plans, actuals });
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, parsed };
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
    const result = await validateBuffer(req.file.buffer);
    if (!result.valid) {
      res.status(422).json(result);
      return;
    }
    res.json({ valid: true, rowCount: result.parsed.length });
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

    const validation = await validateBuffer(req.file.buffer);
    if (!validation.valid) {
      res.status(422).json(validation);
      return;
    }

    const { parsed } = validation;

    // Attempt pre-import snapshot before any DB writes.
    // TODO(Task #62): POST /api/snapshots will be implemented by the Snapshots feature.
    // Until then, this call is expected to fail (non-fatal); snapshotSaved will be false.
    let snapshotSaved = false;
    try {
      const snapshotUrl = `http://localhost:${process.env["PORT"]}/api/snapshots`;
      const snapRes = await fetch(snapshotUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "pre-import" }),
      });
      snapshotSaved = snapRes.ok;
    } catch (e) {
      logger.warn({ err: e }, "Pre-import snapshot failed (non-fatal — Task #62 snapshot API not yet deployed)");
    }

    const existingLines = await db.select().from(budgetLinesTable);
    const existingMap = new Map(existingLines.map((l) => [`${l.category}||${l.lineItem}`, l]));
    const incomingKeys = new Set(parsed.map((p) => `${p.category}||${p.lineItem}`));

    const toDelete = existingLines.filter((l) => !incomingKeys.has(`${l.category}||${l.lineItem}`));
    if (toDelete.length > 0) {
      await db.delete(budgetLinesTable).where(
        inArray(budgetLinesTable.id, toDelete.map((l) => l.id))
      );
    }

    let upserted = 0;
    let inserted = 0;
    let plansWritten = 0;
    let actualsWritten = 0;

    for (const row of parsed) {
      const key = `${row.category}||${row.lineItem}`;
      const existing = existingMap.get(key);

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
      },
    });
  })
);

export default router;
