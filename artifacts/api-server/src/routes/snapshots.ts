import { Router, type IRouter } from "express";
import fs from "fs";
import path from "path";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  ownersTable,
  categoriesTable,
  csvImportRowsTable,
  csvImportsTable,
  budgetLineColumnsTable,
  forecastPlansTable,
  eventsTable,
  alertsTable,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { asyncHandler } from "../middleware/asyncHandler";
import { logger } from "../lib/logger";
import { isValidVpSession } from "../middleware/vpAuth";
import { isValidUserSession } from "./userAuth";
import { triggerAlertEvaluation } from "../lib/runAlertEvaluation";
import { resolveExportCurrency } from "../lib/exportCurrency";

const router: IRouter = Router();

const SNAPSHOTS_DIR = path.join(process.cwd(), "snapshots");
const MAX_SNAPSHOTS = 50;
const PROTECTED_LABELS = ["pre-import", "pre-restore"];
const AUTO_LABELS = ["auto-open", "auto-close"];

function ensureDir(): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

// ─── Snapshot file data shapes ────────────────────────────────────────────────

export interface SnapshotMeta {
  id: string;
  filename: string;
  label: string;
  createdAt: string;
  totalBudget: number;
  totalSpent: number;
  lineCount: number;
  pinned: boolean;
}

interface SnapshotPlan {
  id: number;
  budgetLineId: number;
  month: number;
  year: number;
  plannedAmount: number;
  boardAmount: number | null;
}

interface SnapshotActual {
  id: number;
  budgetLineId: number;
  month: number;
  year: number;
  actualAmount: number;
  invoiceRef: string | null;
}

interface SnapshotBudgetLine {
  id: number;
  category: string;
  subcategory: string | null;
  lineItem: string;
  owner: string | null;
  region: string | null;
  channel: string | null;
  costStatus: string;
  projectionPct: number;
  boardApprovedAmount: number | null;
  customFields: Record<string, string | number | null>;
  // embedded after joining from flat arrays
  plans: SnapshotPlan[];
  actuals: SnapshotActual[];
}

interface SnapshotBudgetLineColumn {
  id: number;
  name: string;
  type: string;
  sortOrder: number;
}

interface SnapshotOwner {
  id: number;
  name: string;
  initials: string;
  color: string;
}

interface SnapshotCategory {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

/** Parsed content of a snapshot JSON file with plans/actuals joined into budget lines */
interface SnapshotBody {
  id: string;
  label: string;
  createdAt: string;
  pinned?: boolean;
  budgetLines: SnapshotBudgetLine[];
  owners: SnapshotOwner[];
  categories: SnapshotCategory[];
  budgetLineColumns: SnapshotBudgetLineColumn[];
}

// ─── File helpers ─────────────────────────────────────────────────────────────

/** Convert a snapshot ID (stem) to its filename */
function idFromStem(id: string): string {
  return id.endsWith(".json") ? id : `${id}.json`;
}

/** Read and parse a snapshot file, joining plans/actuals into budget lines. Returns null if missing/corrupt. */
function readSnapshotFile(filename: string): SnapshotBody | null {
  const filepath = path.join(SNAPSHOTS_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filepath, "utf-8")) as {
      id: string;
      label: string;
      createdAt: string;
      pinned?: boolean;
      data: {
        budgetLines: (Omit<SnapshotBudgetLine, "plans" | "actuals" | "customFields"> & {
          customFields?: Record<string, string | number | null> | null;
        })[];
        monthlyPlans: SnapshotPlan[];
        monthlyActuals: SnapshotActual[];
        owners?: SnapshotOwner[];
        categories?: SnapshotCategory[];
        budgetLineColumns?: SnapshotBudgetLineColumn[];
      };
    };

    // Join plans and actuals into each budget line
    const plansByLine = new Map<number, SnapshotPlan[]>();
    for (const p of raw.data.monthlyPlans) {
      const arr = plansByLine.get(p.budgetLineId) ?? [];
      arr.push(p);
      plansByLine.set(p.budgetLineId, arr);
    }
    const actualsByLine = new Map<number, SnapshotActual[]>();
    for (const a of raw.data.monthlyActuals) {
      const arr = actualsByLine.get(a.budgetLineId) ?? [];
      arr.push(a);
      actualsByLine.set(a.budgetLineId, arr);
    }

    const budgetLines: SnapshotBudgetLine[] = raw.data.budgetLines.map((bl) => ({
      ...bl,
      customFields: bl.customFields ?? {},
      plans: plansByLine.get(bl.id) ?? [],
      actuals: actualsByLine.get(bl.id) ?? [],
    }));

    return {
      id: raw.id,
      label: raw.label,
      createdAt: raw.createdAt,
      pinned: raw.pinned ?? false,
      budgetLines,
      owners: raw.data.owners ?? [],
      categories: raw.data.categories ?? [],
      budgetLineColumns: raw.data.budgetLineColumns ?? [],
    };
  } catch {
    return null;
  }
}

/** Extract SnapshotMeta (with computed totals) from a filename and parsed body */
function parseMeta(filename: string, body: SnapshotBody): SnapshotMeta {
  const totalBudget = body.budgetLines.reduce((sum, bl) => {
    return sum + bl.plans.reduce((s, p) => s + p.plannedAmount, 0);
  }, 0);
  const totalSpent = body.budgetLines.reduce((sum, bl) => {
    return sum + bl.actuals.reduce((s, a) => s + a.actualAmount, 0);
  }, 0);
  return {
    id: body.id,
    filename,
    label: body.label,
    createdAt: body.createdAt,
    totalBudget,
    totalSpent,
    lineCount: body.budgetLines.length,
    pinned: body.pinned ?? false,
  };
}

function listSnapshotFiles(): SnapshotMeta[] {
  ensureDir();
  const files = fs.readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith(".json"));
  const metas: SnapshotMeta[] = [];
  for (const filename of files) {
    const body = readSnapshotFile(filename);
    if (!body) continue;
    metas.push(parseMeta(filename, body));
  }
  return metas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function enforceLimit(): void {
  const metas = listSnapshotFiles();
  if (metas.length < MAX_SNAPSHOTS) return;

  // Sort oldest first; prefer deleting auto-labeled snapshots first, then any others
  const byAge = metas
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Never delete: pinned snapshots, or PROTECTED_LABELS
  const deletable = byAge.filter(
    (m) => !m.pinned && !PROTECTED_LABELS.includes(m.label),
  );
  // Prefer auto-labeled first, then others
  const autoFirst = [
    ...deletable.filter((m) => AUTO_LABELS.includes(m.label)),
    ...deletable.filter((m) => !AUTO_LABELS.includes(m.label)),
  ];

  const excess = metas.length - MAX_SNAPSHOTS + 1;
  const toDelete = autoFirst.slice(0, excess);

  for (const meta of toDelete) {
    try {
      fs.unlinkSync(path.join(SNAPSHOTS_DIR, meta.filename));
      logger.info({ id: meta.id }, "Snapshot auto-deleted (50-file limit)");
    } catch (err) {
      logger.warn({ err, id: meta.id }, "Failed to auto-delete snapshot");
    }
  }
}

export async function createSnapshot(label: string): Promise<SnapshotMeta> {
  ensureDir();
  enforceLimit();

  const now = new Date();
  const ts = now.toISOString().slice(0, 19).replace(/:/g, "-");
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "snapshot";
  const id = `snapshot_${ts}_${safeLabel}`;
  const filename = `${id}.json`;

  const [budgetLines, monthlyPlans, monthlyActuals, owners, categories, budgetLineColumns] = await Promise.all([
    db.select().from(budgetLinesTable),
    db.select().from(monthlyPlansTable),
    db.select().from(monthlyActualsTable),
    db.select().from(ownersTable).orderBy(ownersTable.id),
    db.select().from(categoriesTable).orderBy(categoriesTable.id),
    db.select().from(budgetLineColumnsTable).orderBy(asc(budgetLineColumnsTable.sortOrder), asc(budgetLineColumnsTable.id)),
  ]);

  const snap = {
    id,
    label,
    createdAt: now.toISOString(),
    pinned: false,
    data: { budgetLines, monthlyPlans, monthlyActuals, owners, categories, budgetLineColumns },
  };

  fs.writeFileSync(path.join(SNAPSHOTS_DIR, filename), JSON.stringify(snap, null, 2), "utf-8");
  logger.info({ id, label }, "Snapshot saved");

  // Build meta from the just-stored snapshot (no need to re-read the file)
  const plansByLine = new Map<number, typeof monthlyPlans[number][]>();
  for (const p of monthlyPlans) {
    const arr = plansByLine.get(p.budgetLineId) ?? [];
    arr.push(p);
    plansByLine.set(p.budgetLineId, arr);
  }
  const actualsByLine = new Map<number, typeof monthlyActuals[number][]>();
  for (const a of monthlyActuals) {
    const arr = actualsByLine.get(a.budgetLineId) ?? [];
    arr.push(a);
    actualsByLine.set(a.budgetLineId, arr);
  }
  const totalBudget = budgetLines.reduce((sum, bl) => {
    return sum + (plansByLine.get(bl.id) ?? []).reduce((s, p) => s + p.plannedAmount, 0);
  }, 0);
  const totalSpent = budgetLines.reduce((sum, bl) => {
    return sum + (actualsByLine.get(bl.id) ?? []).reduce((s, a) => s + a.actualAmount, 0);
  }, 0);

  return {
    id,
    filename,
    label,
    createdAt: snap.createdAt,
    totalBudget,
    totalSpent,
    lineCount: budgetLines.length,
    pinned: false,
  };
}

// ─── Diff helpers (shared by compare JSON and PDF endpoints) ─────────────────

interface DiffChange { field: string; from: string | null; to: string | null; }
interface DiffLine {
  status: "added" | "removed" | "changed" | "unchanged";
  lineItem: string;
  category: string;
  subcategory: string | null;
  totalBudgetA: number | null;
  totalBudgetB: number | null;
  changes: DiffChange[];
}
interface SnapshotDiffResult {
  snapshotA: SnapshotMeta;
  snapshotB: SnapshotMeta;
  lines: DiffLine[];
  summary: { added: number; removed: number; changed: number; unchanged: number };
}

function lineKey(bl: SnapshotBudgetLine): string {
  return [
    bl.category,
    bl.subcategory ?? "",
    bl.lineItem,
    bl.owner ?? "",
    bl.region ?? "",
    bl.channel ?? "",
  ]
    .map((v) => v.replace(/\|/g, "\x01"))
    .join("|");
}

function comparePair(a: SnapshotBudgetLine, b: SnapshotBudgetLine): DiffLine {
  const totalA = a.plans.reduce((s, p) => s + p.plannedAmount, 0);
  const totalB = b.plans.reduce((s, p) => s + p.plannedAmount, 0);
  const changes: DiffChange[] = [];

  if (a.costStatus !== b.costStatus)
    changes.push({ field: "costStatus", from: a.costStatus, to: b.costStatus });
  if (a.projectionPct !== b.projectionPct)
    changes.push({ field: "projectionPct", from: String(a.projectionPct), to: String(b.projectionPct) });
  if ((a.boardApprovedAmount ?? null) !== (b.boardApprovedAmount ?? null))
    changes.push({
      field: "boardApprovedAmount",
      from: a.boardApprovedAmount != null ? String(a.boardApprovedAmount) : null,
      to: b.boardApprovedAmount != null ? String(b.boardApprovedAmount) : null,
    });

  // Custom field changes
  const aCf = a.customFields ?? {};
  const bCf = b.customFields ?? {};
  const cfKeys = Array.from(new Set([...Object.keys(aCf), ...Object.keys(bCf)])).sort();
  for (const k of cfKeys) {
    const av = aCf[k];
    const bv = bCf[k];
    if ((av ?? null) !== (bv ?? null)) {
      changes.push({
        field: `customField:${k}`,
        from: av != null ? String(av) : null,
        to: bv != null ? String(bv) : null,
      });
    }
  }

  const planKey = (p: SnapshotPlan) => `${p.year}-${String(p.month).padStart(2, "0")}`;
  const aPlans = new Map<string, SnapshotPlan>();
  for (const p of a.plans) aPlans.set(planKey(p), p);
  const bPlans = new Map<string, SnapshotPlan>();
  for (const p of b.plans) bPlans.set(planKey(p), p);
  for (const pk of Array.from(new Set([...aPlans.keys(), ...bPlans.keys()])).sort()) {
    const av = aPlans.get(pk)?.plannedAmount ?? 0;
    const bv = bPlans.get(pk)?.plannedAmount ?? 0;
    if (av !== bv) changes.push({ field: `plan:${pk}`, from: String(av), to: String(bv) });
  }

  const actualKey = (act: SnapshotActual) => `${act.year}-${String(act.month).padStart(2, "0")}`;
  const aActuals = new Map<string, SnapshotActual>();
  for (const act of a.actuals) aActuals.set(actualKey(act), act);
  const bActuals = new Map<string, SnapshotActual>();
  for (const act of b.actuals) bActuals.set(actualKey(act), act);
  for (const ak of Array.from(new Set([...aActuals.keys(), ...bActuals.keys()])).sort()) {
    const av = aActuals.get(ak)?.actualAmount ?? 0;
    const bv = bActuals.get(ak)?.actualAmount ?? 0;
    if (av !== bv) changes.push({ field: `actual:${ak}`, from: String(av), to: String(bv) });
  }

  return {
    status: changes.length > 0 ? "changed" : "unchanged",
    lineItem: a.lineItem,
    category: a.category,
    subcategory: a.subcategory,
    totalBudgetA: totalA,
    totalBudgetB: totalB,
    changes,
  };
}

function computeSnapshotDiff(aId: string, bId: string): SnapshotDiffResult | { error: string; status: number } {
  const aFile = idFromStem(aId);
  const bFile = idFromStem(bId);
  if (aFile.includes("..") || aFile.includes("/") || bFile.includes("..") || bFile.includes("/"))
    return { error: "Invalid snapshot ID", status: 400 };

  const aBody = readSnapshotFile(aFile);
  const bBody = readSnapshotFile(bFile);
  if (!aBody) return { error: `Snapshot A not found: ${aId}`, status: 404 };
  if (!bBody) return { error: `Snapshot B not found: ${bId}`, status: 404 };

  const aMeta = parseMeta(aFile, aBody);
  const bMeta = parseMeta(bFile, bBody);

  const aMap = new Map<string, SnapshotBudgetLine[]>();
  for (const bl of aBody.budgetLines) {
    const k = lineKey(bl);
    const arr = aMap.get(k) ?? [];
    arr.push(bl);
    aMap.set(k, arr);
  }
  const bMap = new Map<string, SnapshotBudgetLine[]>();
  for (const bl of bBody.budgetLines) {
    const k = lineKey(bl);
    const arr = bMap.get(k) ?? [];
    arr.push(bl);
    bMap.set(k, arr);
  }

  const allKeys = new Set([...aMap.keys(), ...bMap.keys()]);
  const diffLines: DiffLine[] = [];

  for (const key of allKeys) {
    const aArr = aMap.get(key) ?? [];
    const bArr = bMap.get(key) ?? [];
    const maxLen = Math.max(aArr.length, bArr.length);
    for (let i = 0; i < maxLen; i++) {
      const a = aArr[i];
      const b = bArr[i];
      if (a && !b) {
        const totalA = a.plans.reduce((s, p) => s + p.plannedAmount, 0);
        diffLines.push({ status: "removed", lineItem: a.lineItem, category: a.category, subcategory: a.subcategory, totalBudgetA: totalA, totalBudgetB: null, changes: [] });
      } else if (!a && b) {
        const totalB = b.plans.reduce((s, p) => s + p.plannedAmount, 0);
        diffLines.push({ status: "added", lineItem: b.lineItem, category: b.category, subcategory: b.subcategory, totalBudgetA: null, totalBudgetB: totalB, changes: [] });
      } else if (a && b) {
        diffLines.push(comparePair(a, b));
      }
    }
  }

  diffLines.sort((x, y) => {
    const order: Record<string, number> = { added: 0, removed: 1, changed: 2, unchanged: 3 };
    const d = order[x.status] - order[y.status];
    if (d !== 0) return d;
    const cat = x.category.localeCompare(y.category);
    if (cat !== 0) return cat;
    return x.lineItem.localeCompare(y.lineItem);
  });

  const summary = {
    added: diffLines.filter((l) => l.status === "added").length,
    removed: diffLines.filter((l) => l.status === "removed").length,
    changed: diffLines.filter((l) => l.status === "changed").length,
    unchanged: diffLines.filter((l) => l.status === "unchanged").length,
  };

  return { snapshotA: aMeta, snapshotB: bMeta, lines: diffLines, summary };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// ─── GET /snapshots ───────────────────────────────────────────────────────────

router.get(
  "/snapshots",
  asyncHandler(async (_req, res): Promise<void> => {
    const metas = listSnapshotFiles();
    res.json(metas);
  }),
);

// ─── GET /snapshots/compare ───────────────────────────────────────────────────
// NOTE: Must be registered before /snapshots/:id to avoid "compare" being captured as :id

router.get(
  "/snapshots/compare",
  asyncHandler(async (req, res): Promise<void> => {
    const aId = String(req.query.a ?? "").trim();
    const bId = String(req.query.b ?? "").trim();
    if (!aId || !bId) {
      res.status(400).json({ error: "Both 'a' and 'b' query parameters are required" });
      return;
    }
    const result = computeSnapshotDiff(aId, bId);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  }),
);

// ─── GET /snapshots/compare/pdf ──────────────────────────────────────────────

router.get(
  "/snapshots/compare/pdf",
  asyncHandler(async (req, res): Promise<void> => {
    const vpSession = req.headers["x-vp-session"] as string | undefined;
    const userSession = req.headers["x-user-session"] as string | undefined;
    const authed =
      (vpSession && isValidVpSession(vpSession)) ||
      (userSession && isValidUserSession(userSession));
    if (!authed) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const aId = String(req.query.a ?? "").trim();
    const bId = String(req.query.b ?? "").trim();
    if (!aId || !bId) {
      res.status(400).json({ error: "Both 'a' and 'b' query parameters are required" });
      return;
    }
    const includeUnchanged = String(req.query.includeUnchanged ?? "false") === "true";

    const result = computeSnapshotDiff(aId, bId);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const { snapshotA, snapshotB, lines, summary } = result;
    const visibleLines = includeUnchanged ? lines : lines.filter((l) => l.status !== "unchanged");

    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="snapshot-comparison.pdf"');
    doc.pipe(res);

    const money = await resolveExportCurrency(req.query.currency);
    const fmtMoney = money.formatCompact;
    const fmtDate = (iso: string) =>
      new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

    // ── Header ────────────────────────────────────────────────────────────────
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#1a1a2e")
      .text("Hubert Marketing Budget", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(11).font("Helvetica").fillColor("#6b7280")
      .text(`Snapshot Comparison \u2014 Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, { align: "center" });
    if (money.conversionNote) {
      doc.fontSize(8).font("Helvetica-Oblique").fillColor("#6b7280").text(money.conversionNote, { align: "center" });
    }
    doc.moveDown(1);

    // ── Snapshot labels ───────────────────────────────────────────────────────
    const pageW = doc.page.width - 80;
    const halfW = (pageW - 20) / 2;
    const startY = doc.y;

    doc.rect(40, startY, halfW, 50).lineWidth(1).strokeColor("#2563eb").stroke();
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#2563eb").text("A  (BEFORE)", 48, startY + 6, { width: halfW - 16 });
    doc.fontSize(8).font("Helvetica").fillColor("#1a1a2e").text(snapshotA.label, 48, startY + 18, { width: halfW - 16 });
    doc.fontSize(7).fillColor("#6b7280").text(fmtDate(snapshotA.createdAt), 48, startY + 30, { width: halfW - 16 });

    const bx = 40 + halfW + 20;
    doc.rect(bx, startY, halfW, 50).lineWidth(1).strokeColor("#16a34a").stroke();
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#16a34a").text("B  (AFTER)", bx + 8, startY + 6, { width: halfW - 16 });
    doc.fontSize(8).font("Helvetica").fillColor("#1a1a2e").text(snapshotB.label, bx + 8, startY + 18, { width: halfW - 16 });
    doc.fontSize(7).fillColor("#6b7280").text(fmtDate(snapshotB.createdAt), bx + 8, startY + 30, { width: halfW - 16 });

    doc.y = startY + 60;
    doc.fillColor("#1a1a2e");
    doc.moveDown(0.8);

    // ── Summary chips ─────────────────────────────────────────────────────────
    const chips = [
      { label: "Added",     count: summary.added,     color: "#16a34a" },
      { label: "Removed",   count: summary.removed,   color: "#dc2626" },
      { label: "Changed",   count: summary.changed,   color: "#d97706" },
      { label: "Unchanged", count: summary.unchanged, color: "#6b7280" },
    ];
    const chipW = pageW / 4;
    const chipY = doc.y;
    chips.forEach((chip, i) => {
      const cx = 40 + i * chipW;
      doc.rect(cx, chipY, chipW - 8, 36).lineWidth(0.5).strokeColor(chip.color).stroke();
      doc.fontSize(16).font("Helvetica-Bold").fillColor(chip.color).text(String(chip.count), cx + 8, chipY + 4, { width: chipW - 24 });
      doc.fontSize(7).font("Helvetica").fillColor(chip.color).text(chip.label.toUpperCase(), cx + 8, chipY + 22, { width: chipW - 24 });
    });
    doc.y = chipY + 46;
    doc.fillColor("#1a1a2e");
    doc.moveDown(0.5);

    if (!includeUnchanged && summary.unchanged > 0) {
      doc.fontSize(8).font("Helvetica").fillColor("#6b7280")
        .text(`${summary.unchanged} unchanged line${summary.unchanged !== 1 ? "s" : ""} hidden.`, { align: "right" });
      doc.moveDown(0.3);
    }

    // ── Diff table ────────────────────────────────────────────────────────────
    const STATUS_COLORS: Record<string, string> = {
      added: "#16a34a", removed: "#dc2626", changed: "#d97706", unchanged: "#6b7280",
    };

    const colWidths = [70, 140, 80, 80, 70, 75];
    const tableX = 40;
    const totalTableW = colWidths.reduce((a, b) => a + b, 0);
    const rowH = 18;
    let y = doc.y;

    const drawTableHeader = () => {
      doc.rect(tableX, y, totalTableW, rowH).fill("#f3f4f6");
      let cx = tableX;
      for (const [h, w] of [
        ["Status", colWidths[0]], ["Line Item", colWidths[1]], ["Category", colWidths[2]],
        ["Budget A", colWidths[3]], ["Budget B", colWidths[4]], ["Delta", colWidths[5]],
      ] as [string, number][]) {
        doc.fontSize(7).font("Helvetica-Bold").fillColor("#374151").text(h, cx + 4, y + 5, { width: w - 8 });
        cx += w;
      }
      y += rowH;
    };

    drawTableHeader();

    for (const line of visibleLines) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 40;
        drawTableHeader();
      }

      const statusColor = STATUS_COLORS[line.status] ?? "#6b7280";
      const delta = line.totalBudgetA != null && line.totalBudgetB != null
        ? line.totalBudgetB - line.totalBudgetA : null;

      const cells: [string, number, string][] = [
        [line.status.charAt(0).toUpperCase() + line.status.slice(1), colWidths[0], statusColor],
        [line.lineItem, colWidths[1], "#1a1a2e"],
        [(line.category + (line.subcategory ? ` · ${line.subcategory}` : "")), colWidths[2], "#1a1a2e"],
        [line.totalBudgetA != null ? fmtMoney(line.totalBudgetA) : "—", colWidths[3], "#6b7280"],
        [line.totalBudgetB != null ? fmtMoney(line.totalBudgetB) : "—", colWidths[4], "#1a1a2e"],
        [delta != null ? (delta > 0 ? "+" : "") + fmtMoney(delta) : "—", colWidths[5], delta != null && delta > 0 ? "#16a34a" : delta != null && delta < 0 ? "#dc2626" : "#6b7280"],
      ];

      let cx = tableX;
      for (const [text, w, color] of cells) {
        doc.fontSize(7).font("Helvetica").fillColor(color).text(text, cx + 4, y + 4, { width: w - 8, ellipsis: true, lineBreak: false });
        cx += w;
      }
      doc.moveTo(tableX, y + rowH - 1).lineTo(tableX + totalTableW, y + rowH - 1).strokeColor("#f0f0f0").lineWidth(0.5).stroke();
      y += rowH;

      if (line.status === "changed" && line.changes.length > 0) {
        const changeText = line.changes
          .slice(0, 4)
          .map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`)
          .join("  |  ");
        if (y > doc.page.height - 60) { doc.addPage(); y = 40; drawTableHeader(); }
        doc.fontSize(6).font("Helvetica").fillColor("#6b7280").text(changeText, tableX + colWidths[0] + 4, y + 2, { width: totalTableW - colWidths[0] - 8, ellipsis: true, lineBreak: false });
        y += 12;
      }
    }

    if (visibleLines.length === 0) {
      doc.y = y + 8;
      doc.fontSize(10).font("Helvetica").fillColor("#6b7280").text("No differences found between these snapshots.", { align: "center" });
    }

    doc.y = y + 16;
    doc.fontSize(7).font("Helvetica").fillColor("#9ca3af")
      .text("Hubert Marketing \u00b7 Confidential \u00b7 Snapshot Comparison", { align: "center" });

    doc.end();
  }),
);

// ─── GET /snapshots/:id ───────────────────────────────────────────────────────

router.get(
  "/snapshots/:id",
  asyncHandler(async (req, res): Promise<void> => {
    const filename = idFromStem(String(req.params.id));
    if (filename.includes("..") || filename.includes("/")) {
      res.status(400).json({ error: "Invalid snapshot ID" });
      return;
    }
    const body = readSnapshotFile(filename);
    if (!body) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }
    const meta = parseMeta(filename, body);
    res.json({ ...meta, ...body });
  }),
);

// ─── POST /snapshots ──────────────────────────────────────────────────────────

router.post(
  "/snapshots",
  asyncHandler(async (req, res): Promise<void> => {
    const rawLabel = req.body?.label;
    const label = typeof rawLabel === "string" ? rawLabel.trim() : "manual";
    const meta = await createSnapshot(label || "manual");
    res.status(201).json(meta);
  }),
);

// ─── POST /snapshots/import ───────────────────────────────────────────────────
// NOTE: Must be registered before /snapshots/:id/restore to avoid "import" being captured as :id

router.post(
  "/snapshots/import",
  asyncHandler(async (req, res): Promise<void> => {
    ensureDir();

    const body = req.body as Record<string, unknown> | null | undefined;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }

    // Accept the joined format returned by GET /snapshots/:id
    // { id, label, createdAt, pinned, budgetLines (with .plans/.actuals/.customFields), owners, categories, budgetLineColumns }
    const budgetLines = body.budgetLines;
    const owners = body.owners ?? [];
    const categories = body.categories ?? [];
    const budgetLineColumns = body.budgetLineColumns ?? [];

    if (!Array.isArray(budgetLineColumns)) {
      res.status(400).json({ error: "Invalid snapshot: budgetLineColumns must be an array" });
      return;
    }

    if (!Array.isArray(budgetLines)) {
      res.status(400).json({ error: "Invalid snapshot: budgetLines must be an array" });
      return;
    }

    if (!Array.isArray(owners) || !Array.isArray(categories)) {
      res.status(400).json({ error: "Invalid snapshot: owners and categories must be arrays" });
      return;
    }

    // Validate budget line shapes and their embedded plans/actuals
    for (const bl of budgetLines as unknown[]) {
      if (!bl || typeof bl !== "object" || Array.isArray(bl)) {
        res.status(400).json({ error: "Invalid snapshot: each budget line must be an object" });
        return;
      }
      const blObj = bl as Record<string, unknown>;

      if (typeof blObj.id !== "number") {
        res.status(400).json({
          error: "Invalid snapshot: each budget line must have a numeric id field",
        });
        return;
      }
      if (typeof blObj.lineItem !== "string" || !blObj.lineItem) {
        res.status(400).json({
          error: "Invalid snapshot: each budget line must have a non-empty lineItem string",
        });
        return;
      }
      if (typeof blObj.category !== "string" || !blObj.category) {
        res.status(400).json({
          error: "Invalid snapshot: each budget line must have a non-empty category string",
        });
        return;
      }

      if (!Array.isArray(blObj.plans) || !Array.isArray(blObj.actuals)) {
        res.status(400).json({
          error: "Invalid snapshot: each budget line must have plans and actuals arrays",
        });
        return;
      }

      for (const p of blObj.plans as unknown[]) {
        if (!p || typeof p !== "object" || Array.isArray(p)) {
          res.status(400).json({ error: "Invalid snapshot: each plan entry must be an object" });
          return;
        }
        const pObj = p as Record<string, unknown>;
        if (typeof pObj.month !== "number" || typeof pObj.year !== "number" || typeof pObj.plannedAmount !== "number") {
          res.status(400).json({
            error: "Invalid snapshot: each plan must have numeric month, year, and plannedAmount",
          });
          return;
        }
      }

      for (const a of blObj.actuals as unknown[]) {
        if (!a || typeof a !== "object" || Array.isArray(a)) {
          res.status(400).json({ error: "Invalid snapshot: each actual entry must be an object" });
          return;
        }
        const aObj = a as Record<string, unknown>;
        if (typeof aObj.month !== "number" || typeof aObj.year !== "number" || typeof aObj.actualAmount !== "number") {
          res.status(400).json({
            error: "Invalid snapshot: each actual must have numeric month, year, and actualAmount",
          });
          return;
        }
      }
    }

    enforceLimit();

    // Generate a fresh ID so it never collides with an existing snapshot
    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace(/:/g, "-");
    const rawLabel = body.label;
    const importedLabel =
      typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : "imported";
    const safeLabel = importedLabel.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const newId = `snapshot_${ts}_${safeLabel}`;
    const filename = `${newId}.json`;

    // Convert the joined format back to the flat on-disk format
    const flatBudgetLines = (budgetLines as Array<Record<string, unknown>>).map((bl) => {
      const { plans: _plans, actuals: _actuals, ...rest } = bl;
      return rest;
    });

    const monthlyPlans: unknown[] = [];
    const monthlyActuals: unknown[] = [];
    for (const bl of budgetLines as Array<Record<string, unknown>>) {
      const blId = bl.id;
      for (const p of bl.plans as Array<Record<string, unknown>>) {
        monthlyPlans.push({ ...p, budgetLineId: blId });
      }
      for (const a of bl.actuals as Array<Record<string, unknown>>) {
        monthlyActuals.push({ ...a, budgetLineId: blId });
      }
    }

    const snap = {
      id: newId,
      label: importedLabel,
      createdAt: now.toISOString(),
      pinned: false,
      data: {
        budgetLines: flatBudgetLines,
        monthlyPlans,
        monthlyActuals,
        owners,
        categories,
        budgetLineColumns,
      },
    };

    fs.writeFileSync(path.join(SNAPSHOTS_DIR, filename), JSON.stringify(snap, null, 2), "utf-8");
    logger.info({ id: newId, label: importedLabel }, "Snapshot imported from file");

    // Build and return meta
    const storedBody = readSnapshotFile(filename);
    if (!storedBody) {
      res.status(500).json({ error: "Failed to read snapshot after import" });
      return;
    }
    res.status(201).json(parseMeta(filename, storedBody));
  }),
);

// ─── POST /snapshots/:id/restore ─────────────────────────────────────────────

router.post(
  "/snapshots/:id/restore",
  asyncHandler(async (req, res): Promise<void> => {
    const id = String(req.params.id ?? "");
    if (!id || !/^[\w-]+$/.test(id)) {
      res.status(400).json({ error: "Invalid snapshot id" });
      return;
    }

    const filepath = path.join(SNAPSHOTS_DIR, `${id}.json`);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }

    const body = readSnapshotFile(`${id}.json`);
    if (!body) {
      res.status(500).json({ error: "Failed to read snapshot file" });
      return;
    }

    // Save pre-restore snapshot before touching DB — abort if this fails
    let preRestoreMeta: SnapshotMeta;
    try {
      preRestoreMeta = await createSnapshot("pre-restore");
    } catch (e) {
      logger.error({ err: e }, "Pre-restore snapshot failed — aborting restore");
      res.status(500).json({
        error: "Could not save pre-restore backup. Restore aborted to protect your data.",
      });
      return;
    }

    await db.transaction(async (tx) => {
      /**
       * A snapshot holds budget lines, plans and actuals — not forecasts,
       * events or alerts. But restoring deletes every budget line, and
       * forecast_plans cascades from it while events and alerts have their
       * link set to null. So restoring a snapshot to undo a bad import also
       * destroyed every forecast version's figures and detached every event
       * from its budget line, with nothing in the snapshot to put them back.
       *
       * Capture those associations here and re-point them afterwards. Matching
       * is by category + line item rather than id, because the restore
       * re-inserts lines and Postgres hands out fresh serial ids.
       */
      const priorLines = await tx
        .select({ id: budgetLinesTable.id, category: budgetLinesTable.category, lineItem: budgetLinesTable.lineItem })
        .from(budgetLinesTable);
      const keyByOldLineId = new Map<number, string>(
        priorLines.map((l) => [l.id, `${l.category}||${l.lineItem}`]),
      );
      const priorForecastPlans = await tx.select().from(forecastPlansTable);
      const priorEventLinks = await tx
        .select({ id: eventsTable.id, budgetLineId: eventsTable.budgetLineId })
        .from(eventsTable);
      const priorAlertLinks = await tx
        .select({ id: alertsTable.id, budgetLineId: alertsTable.budgetLineId })
        .from(alertsTable);

      // Delete in FK order (csv_import_rows references budget_lines, must go first)
      await tx.delete(csvImportRowsTable);
      await tx.delete(csvImportsTable);
      await tx.delete(monthlyActualsTable);
      await tx.delete(monthlyPlansTable);
      await tx.delete(budgetLinesTable);
      await tx.delete(ownersTable);
      await tx.delete(categoriesTable);
      await tx.delete(budgetLineColumnsTable);

      // Re-insert custom column definitions
      for (const col of body.budgetLineColumns) {
        await tx.insert(budgetLineColumnsTable).values({
          name: col.name,
          type: col.type,
          sortOrder: col.sortOrder,
        });
      }

      // Re-insert categories
      for (const cat of body.categories) {
        await tx.insert(categoriesTable).values({
          name: cat.name,
          color: cat.color,
          description: cat.description ?? undefined,
        });
      }

      // Re-insert owners
      for (const owner of body.owners) {
        await tx.insert(ownersTable).values({
          name: owner.name,
          initials: owner.initials,
          color: owner.color,
        });
      }

      // Re-insert budget lines, tracking old id → new id for FK remapping
      const lineIdMap = new Map<number, number>();
      const newIdByKey = new Map<string, number>();
      for (const bl of body.budgetLines) {
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
            customFields: bl.customFields ?? {},
          })
          .returning();
        lineIdMap.set(bl.id, inserted.id);
        newIdByKey.set(`${bl.category}||${bl.lineItem}`, inserted.id);
      }

      // Put forecasts, events and alerts back on their lines.
      const remap = (oldLineId: number | null): number | undefined => {
        if (oldLineId == null) return undefined;
        const key = keyByOldLineId.get(oldLineId);
        return key ? newIdByKey.get(key) : undefined;
      };

      for (const fp of priorForecastPlans) {
        const newLineId = remap(fp.budgetLineId);
        if (!newLineId) continue;
        await tx.insert(forecastPlansTable).values({
          versionId: fp.versionId,
          budgetLineId: newLineId,
          month: fp.month,
          year: fp.year,
          plannedAmount: fp.plannedAmount,
        });
      }
      for (const ev of priorEventLinks) {
        const newLineId = remap(ev.budgetLineId);
        if (!newLineId) continue;
        await tx.update(eventsTable).set({ budgetLineId: newLineId }).where(eq(eventsTable.id, ev.id));
      }
      for (const al of priorAlertLinks) {
        const newLineId = remap(al.budgetLineId);
        if (!newLineId) continue;
        await tx.update(alertsTable).set({ budgetLineId: newLineId }).where(eq(alertsTable.id, al.id));
      }

      // Re-insert monthly plans using embedded plans array (joined by readSnapshotFile)
      for (const bl of body.budgetLines) {
        const newLineId = lineIdMap.get(bl.id);
        if (!newLineId) continue;
        for (const p of bl.plans) {
          await tx.insert(monthlyPlansTable).values({
            budgetLineId: newLineId,
            month: p.month,
            year: p.year,
            plannedAmount: p.plannedAmount,
            boardAmount: p.boardAmount ?? undefined,
          });
        }
      }

      // Re-insert monthly actuals
      for (const bl of body.budgetLines) {
        const newLineId = lineIdMap.get(bl.id);
        if (!newLineId) continue;
        for (const a of bl.actuals) {
          await tx.insert(monthlyActualsTable).values({
            budgetLineId: newLineId,
            month: a.month,
            year: a.year,
            actualAmount: a.actualAmount,
            invoiceRef: a.invoiceRef ?? undefined,
          });
        }
      }
    });

    logger.info({ id, preRestoreId: preRestoreMeta.id }, "Snapshot restored");
    res.json({
      success: true,
      restoredFrom: id,
      preRestoreSnapshot: preRestoreMeta,
    });
    triggerAlertEvaluation();
  }),
);

// ─── DELETE /snapshots/:id ────────────────────────────────────────────────────

router.delete(
  "/snapshots/:id",
  asyncHandler(async (req, res): Promise<void> => {
    const id = String(req.params.id ?? "");
    if (!id || !/^[\w-]+$/.test(id)) {
      res.status(400).json({ error: "Invalid snapshot id" });
      return;
    }
    const filename = idFromStem(id);
    if (filename.includes("..") || filename.includes("/")) {
      res.status(400).json({ error: "Invalid snapshot ID" });
      return;
    }
    const filepath = path.join(SNAPSHOTS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }
    const body = readSnapshotFile(filename);
    if (body && PROTECTED_LABELS.includes(body.label)) {
      res.status(403).json({ error: `Snapshot with label "${body.label}" is protected and cannot be deleted` });
      return;
    }
    fs.unlinkSync(filepath);
    logger.info({ id }, "Snapshot deleted");
    res.status(204).send();
  }),
);

// ─── PATCH /snapshots/:id ────────────────────────────────────────────────────
// Rename the label stored in the snapshot JSON (filename/id stays unchanged)

router.patch(
  "/snapshots/:id",
  asyncHandler(async (req, res): Promise<void> => {
    const id = String(req.params.id ?? "");
    if (!id || !/^[\w-]+$/.test(id)) {
      res.status(400).json({ error: "Invalid snapshot id" });
      return;
    }
    const filename = idFromStem(id);
    if (filename.includes("..") || filename.includes("/")) {
      res.status(400).json({ error: "Invalid snapshot ID" });
      return;
    }
    const filepath = path.join(SNAPSHOTS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }

    const rawLabel = req.body?.label;
    if (typeof rawLabel !== "string" || !rawLabel.trim()) {
      res.status(400).json({ error: "Request body must include a non-empty 'label' string" });
      return;
    }
    const label = rawLabel.trim().slice(0, 40);

    let rawJson: Record<string, unknown>;
    try {
      rawJson = JSON.parse(fs.readFileSync(filepath, "utf-8")) as Record<string, unknown>;
    } catch {
      res.status(500).json({ error: "Failed to read snapshot file" });
      return;
    }
    rawJson.label = label;
    fs.writeFileSync(filepath, JSON.stringify(rawJson, null, 2), "utf-8");

    const body = readSnapshotFile(filename);
    if (!body) {
      res.status(500).json({ error: "Failed to re-read snapshot after update" });
      return;
    }
    logger.info({ id, label }, "Snapshot label renamed");
    res.json(parseMeta(filename, body));
  }),
);

// ─── PATCH /snapshots/:id/pin ─────────────────────────────────────────────────

router.patch(
  "/snapshots/:id/pin",
  asyncHandler(async (req, res): Promise<void> => {
    const filename = idFromStem(String(req.params.id));
    if (filename.includes("..") || filename.includes("/")) {
      res.status(400).json({ error: "Invalid snapshot ID" });
      return;
    }
    const filepath = path.join(SNAPSHOTS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }
    if (typeof req.body?.pinned !== "boolean") {
      res.status(400).json({ error: "Request body must include a boolean 'pinned' field" });
      return;
    }
    const pinned: boolean = req.body.pinned;

    // Update pinned flag directly in the raw stored JSON (preserving flat format)
    let rawJson: Record<string, unknown>;
    try {
      rawJson = JSON.parse(fs.readFileSync(filepath, "utf-8")) as Record<string, unknown>;
    } catch {
      res.status(500).json({ error: "Failed to read snapshot file" });
      return;
    }
    rawJson.pinned = pinned;
    fs.writeFileSync(filepath, JSON.stringify(rawJson, null, 2), "utf-8");

    const body = readSnapshotFile(filename);
    if (!body) {
      res.status(500).json({ error: "Failed to re-read snapshot after update" });
      return;
    }
    logger.info({ filename, pinned }, "Snapshot pin state updated");
    res.json(parseMeta(filename, body));
  }),
);

export default router;
