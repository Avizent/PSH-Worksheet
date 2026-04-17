import { Router, type IRouter } from "express";
import fs from "fs";
import path from "path";
import { db, budgetLinesTable, monthlyPlansTable, monthlyActualsTable, ownersTable, categoriesTable } from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SNAPSHOTS_DIR = path.resolve(process.cwd(), "snapshots");
const MAX_SNAPSHOTS = 50;
const AUTO_LABELS = ["auto-open", "auto-close"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

function makeStem(timestamp: string, label: string): string {
  // timestamp ISO like "2026-04-17T14:32:00.000Z" → replace colons with dashes
  const ts = timestamp.replace(/:/g, "-").replace(/\..+$/, "");
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `snapshot_${ts}_${safeLabel}`;
}

interface SnapshotMeta {
  id: string;
  timestamp: string;
  label: string;
  totalBudget: number;
  totalSpent: number;
  lineCount: number;
}

interface SnapshotPlan {
  month: number;
  year: number;
  plannedAmount: number;
  boardAmount: number | null;
}

interface SnapshotActual {
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
  plans: SnapshotPlan[];
  actuals: SnapshotActual[];
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

interface SnapshotBody {
  timestamp: string;
  label: string;
  budgetLines: SnapshotBudgetLine[];
  owners: SnapshotOwner[];
  categories: SnapshotCategory[];
}

function parseMeta(filename: string, body: SnapshotBody): SnapshotMeta {
  const id = filename.replace(/\.json$/, "");
  const totalBudget = body.budgetLines.reduce((sum, bl) => {
    const planTotal = bl.plans.reduce((s, p) => s + p.plannedAmount, 0);
    return sum + planTotal;
  }, 0);
  const totalSpent = body.budgetLines.reduce((sum, bl) => {
    const actualTotal = bl.actuals.reduce((s, a) => s + a.actualAmount, 0);
    return sum + actualTotal;
  }, 0);
  return {
    id,
    timestamp: body.timestamp,
    label: body.label,
    totalBudget,
    totalSpent,
    lineCount: body.budgetLines.length,
  };
}

async function captureSnapshot(label: string): Promise<{ meta: SnapshotMeta; filename: string }> {
  ensureDir();

  const timestamp = new Date().toISOString();
  const stem = makeStem(timestamp, label);
  const filename = `${stem}.json`;
  const filepath = path.join(SNAPSHOTS_DIR, filename);

  // Fetch all DB data
  const [budgetLines, plans, actuals, owners, categories] = await Promise.all([
    db.select().from(budgetLinesTable).orderBy(budgetLinesTable.id),
    db.select().from(monthlyPlansTable),
    db.select().from(monthlyActualsTable),
    db.select().from(ownersTable).orderBy(ownersTable.id),
    db.select().from(categoriesTable).orderBy(categoriesTable.id),
  ]);

  const plansByLine = new Map<number, SnapshotPlan[]>();
  for (const p of plans) {
    const arr = plansByLine.get(p.budgetLineId) ?? [];
    arr.push({ month: p.month, year: p.year, plannedAmount: p.plannedAmount, boardAmount: p.boardAmount ?? null });
    plansByLine.set(p.budgetLineId, arr);
  }

  const actualsByLine = new Map<number, SnapshotActual[]>();
  for (const a of actuals) {
    const arr = actualsByLine.get(a.budgetLineId) ?? [];
    arr.push({ month: a.month, year: a.year, actualAmount: a.actualAmount, invoiceRef: a.invoiceRef ?? null });
    actualsByLine.set(a.budgetLineId, arr);
  }

  const body: SnapshotBody = {
    timestamp,
    label,
    budgetLines: budgetLines.map((bl) => ({
      id: bl.id,
      category: bl.category,
      subcategory: bl.subcategory ?? null,
      lineItem: bl.lineItem,
      owner: bl.owner ?? null,
      region: bl.region ?? null,
      channel: bl.channel ?? null,
      costStatus: bl.costStatus,
      projectionPct: bl.projectionPct,
      boardApprovedAmount: bl.boardApprovedAmount ?? null,
      plans: plansByLine.get(bl.id) ?? [],
      actuals: actualsByLine.get(bl.id) ?? [],
    })),
    owners: owners.map((o) => ({ id: o.id, name: o.name, initials: o.initials, color: o.color })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color, description: c.description ?? null })),
  };

  fs.writeFileSync(filepath, JSON.stringify(body, null, 2), "utf-8");
  logger.info({ label, filename }, "Snapshot saved");

  // Housekeeping: trim oldest auto-open/auto-close beyond max
  applyHousekeeping();

  const meta = parseMeta(filename, body);
  return { meta, filename };
}

function listSnapshotFiles(): string[] {
  ensureDir();
  return fs
    .readdirSync(SNAPSHOTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse(); // newest first (ISO timestamps sort lexicographically)
}

function applyHousekeeping() {
  const files = listSnapshotFiles().reverse(); // oldest first for deletion
  if (files.length <= MAX_SNAPSHOTS) return;

  const excess = files.length - MAX_SNAPSHOTS;
  let deleted = 0;
  for (const file of files) {
    if (deleted >= excess) break;
    // Only auto-delete auto-open/auto-close snapshots
    const isAuto = AUTO_LABELS.some((label) => file.includes(`_${label}.json`));
    if (isAuto) {
      try {
        fs.unlinkSync(path.join(SNAPSHOTS_DIR, file));
        deleted++;
      } catch (e) {
        logger.warn({ file, err: e }, "Failed to delete snapshot during housekeeping");
      }
    }
  }
}

function readSnapshotFile(filename: string): SnapshotBody | null {
  const filepath = path.join(SNAPSHOTS_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8")) as SnapshotBody;
  } catch {
    return null;
  }
}

function idFromStem(id: string): string {
  return id.endsWith(".json") ? id : `${id}.json`;
}

// ─── POST /snapshots ─────────────────────────────────────────────────────────

router.post("/snapshots", asyncHandler(async (req, res): Promise<void> => {
  const label = String(req.body?.label ?? "manual").trim() || "manual";
  const { meta } = await captureSnapshot(label);
  res.status(201).json(meta);
}));

// ─── GET /snapshots ───────────────────────────────────────────────────────────

router.get("/snapshots", asyncHandler(async (_req, res): Promise<void> => {
  const files = listSnapshotFiles();
  const metas: SnapshotMeta[] = [];
  for (const file of files) {
    const body = readSnapshotFile(file);
    if (body) {
      metas.push(parseMeta(file, body));
    }
  }
  res.json(metas);
}));

// ─── GET /snapshots/:id ───────────────────────────────────────────────────────

router.get("/snapshots/:id", asyncHandler(async (req, res): Promise<void> => {
  const filename = idFromStem(req.params.id);
  // Prevent directory traversal
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
}));

// ─── POST /snapshots/:id/restore ─────────────────────────────────────────────

router.post("/snapshots/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const filename = idFromStem(req.params.id);
  if (filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "Invalid snapshot ID" });
    return;
  }

  const body = readSnapshotFile(filename);
  if (!body) {
    res.status(404).json({ error: "Snapshot not found" });
    return;
  }

  // Save pre-restore snapshot before touching DB
  let preRestoreMeta: SnapshotMeta | null = null;
  try {
    const result = await captureSnapshot("pre-restore");
    preRestoreMeta = result.meta;
  } catch (e) {
    logger.warn({ err: e }, "Pre-restore snapshot failed (continuing with restore)");
  }

  // Restore: delete in correct order to respect FK constraints, then re-insert
  await db.delete(monthlyActualsTable);
  await db.delete(monthlyPlansTable);
  await db.delete(budgetLinesTable);
  await db.delete(ownersTable);
  await db.delete(categoriesTable);

  // Re-insert categories
  const catIdMap = new Map<number, number>(); // old id → new id
  for (const cat of body.categories) {
    const [inserted] = await db
      .insert(categoriesTable)
      .values({ name: cat.name, color: cat.color, description: cat.description ?? undefined })
      .returning();
    catIdMap.set(cat.id, inserted.id);
  }

  // Re-insert owners
  for (const owner of body.owners) {
    await db.insert(ownersTable).values({ name: owner.name, initials: owner.initials, color: owner.color });
  }

  // Re-insert budget lines (track old id → new id for monthly data mapping)
  const lineIdMap = new Map<number, number>(); // old id → new id
  for (const bl of body.budgetLines) {
    const [inserted] = await db
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

  // Re-insert monthly plans
  for (const bl of body.budgetLines) {
    const newLineId = lineIdMap.get(bl.id);
    if (!newLineId) continue;
    for (const p of bl.plans) {
      await db.insert(monthlyPlansTable).values({
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
      await db.insert(monthlyActualsTable).values({
        budgetLineId: newLineId,
        month: a.month,
        year: a.year,
        actualAmount: a.actualAmount,
        invoiceRef: a.invoiceRef ?? undefined,
      });
    }
  }

  logger.info({ filename, preRestoreId: preRestoreMeta?.id }, "Snapshot restored");

  res.json({
    restored: parseMeta(filename, body),
    preRestore: preRestoreMeta,
  });
}));

// ─── DELETE /snapshots/:id ────────────────────────────────────────────────────

router.delete("/snapshots/:id", asyncHandler(async (req, res): Promise<void> => {
  const filename = idFromStem(req.params.id);
  if (filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "Invalid snapshot ID" });
    return;
  }
  const filepath = path.join(SNAPSHOTS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: "Snapshot not found" });
    return;
  }
  fs.unlinkSync(filepath);
  logger.info({ filename }, "Snapshot deleted");
  res.status(204).send();
}));

export default router;
