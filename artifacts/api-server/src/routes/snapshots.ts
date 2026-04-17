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
  pinned: boolean;
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
  pinned?: boolean;
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
    pinned: body.pinned ?? false,
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
    pinned: false,
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
    // Only auto-delete auto-open/auto-close snapshots; never delete pinned ones
    const isAuto = AUTO_LABELS.some((label) => file.includes(`_${label}.json`));
    if (!isAuto) continue;
    const body = readSnapshotFile(file);
    if (body?.pinned) continue;
    try {
      fs.unlinkSync(path.join(SNAPSHOTS_DIR, file));
      deleted++;
    } catch (e) {
      logger.warn({ file, err: e }, "Failed to delete snapshot during housekeeping");
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

// ─── GET /snapshots/compare ───────────────────────────────────────────────────

router.get("/snapshots/compare", asyncHandler(async (req, res): Promise<void> => {
  const aId = String(req.query.a ?? "").trim();
  const bId = String(req.query.b ?? "").trim();

  if (!aId || !bId) {
    res.status(400).json({ error: "Both 'a' and 'b' query parameters are required" });
    return;
  }

  const aFile = idFromStem(aId);
  const bFile = idFromStem(bId);

  if (aFile.includes("..") || aFile.includes("/") || bFile.includes("..") || bFile.includes("/")) {
    res.status(400).json({ error: "Invalid snapshot ID" });
    return;
  }

  const aBody = readSnapshotFile(aFile);
  const bBody = readSnapshotFile(bFile);

  if (!aBody) {
    res.status(404).json({ error: `Snapshot A not found: ${aId}` });
    return;
  }
  if (!bBody) {
    res.status(404).json({ error: `Snapshot B not found: ${bId}` });
    return;
  }

  const aMeta = parseMeta(aFile, aBody);
  const bMeta = parseMeta(bFile, bBody);

  // Build lookup maps keyed by all stable identifying fields to avoid collisions.
  // Budget lines have no guaranteed unique business key across snapshots, so we use
  // a composite of every discriminating field. Duplicates within a snapshot would
  // be a data-integrity issue but are guarded below with a per-key array to avoid
  // silently dropping rows.
  const lineKey = (bl: SnapshotBudgetLine) =>
    [
      bl.category,
      bl.subcategory ?? "",
      bl.lineItem,
      bl.owner ?? "",
      bl.region ?? "",
      bl.channel ?? "",
    ]
      .map((v) => v.replace(/\|/g, "\x01"))
      .join("|");

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

  const diffLines: DiffLine[] = [];

  // Helper: compare two matched lines and produce a DiffLine entry
  function comparePair(a: SnapshotBudgetLine, b: SnapshotBudgetLine): DiffLine {
    const totalA = a.plans.reduce((s, p) => s + p.plannedAmount, 0);
    const totalB = b.plans.reduce((s, p) => s + p.plannedAmount, 0);

    const changes: DiffChange[] = [];

    // Compare scalar fields
    if (a.costStatus !== b.costStatus) {
      changes.push({ field: "costStatus", from: a.costStatus, to: b.costStatus });
    }
    if (a.projectionPct !== b.projectionPct) {
      changes.push({ field: "projectionPct", from: String(a.projectionPct), to: String(b.projectionPct) });
    }
    if ((a.boardApprovedAmount ?? null) !== (b.boardApprovedAmount ?? null)) {
      changes.push({
        field: "boardApprovedAmount",
        from: a.boardApprovedAmount != null ? String(a.boardApprovedAmount) : null,
        to: b.boardApprovedAmount != null ? String(b.boardApprovedAmount) : null,
      });
    }

    // Compare monthly plans: build month-year keyed maps
    const planKey = (p: SnapshotPlan) => `${p.year}-${String(p.month).padStart(2, "0")}`;
    const aPlans = new Map<string, SnapshotPlan>();
    for (const p of a.plans) aPlans.set(planKey(p), p);
    const bPlans = new Map<string, SnapshotPlan>();
    for (const p of b.plans) bPlans.set(planKey(p), p);

    const allPlanKeys = new Set([...aPlans.keys(), ...bPlans.keys()]);
    for (const pk of Array.from(allPlanKeys).sort()) {
      const ap = aPlans.get(pk);
      const bp = bPlans.get(pk);
      const av = ap?.plannedAmount ?? 0;
      const bv = bp?.plannedAmount ?? 0;
      if (av !== bv) {
        changes.push({ field: `plan:${pk}`, from: String(av), to: String(bv) });
      }
    }

    // Compare monthly actuals
    const actualKey = (act: SnapshotActual) => `${act.year}-${String(act.month).padStart(2, "0")}`;
    const aActuals = new Map<string, SnapshotActual>();
    for (const act of a.actuals) aActuals.set(actualKey(act), act);
    const bActuals = new Map<string, SnapshotActual>();
    for (const act of b.actuals) bActuals.set(actualKey(act), act);

    const allActualKeys = new Set([...aActuals.keys(), ...bActuals.keys()]);
    for (const ak of Array.from(allActualKeys).sort()) {
      const aa = aActuals.get(ak);
      const ba = bActuals.get(ak);
      const av = aa?.actualAmount ?? 0;
      const bv = ba?.actualAmount ?? 0;
      if (av !== bv) {
        changes.push({ field: `actual:${ak}`, from: String(av), to: String(bv) });
      }
    }

    const status = changes.length > 0 ? "changed" : "unchanged";
    return {
      status,
      lineItem: a.lineItem,
      category: a.category,
      subcategory: a.subcategory,
      totalBudgetA: totalA,
      totalBudgetB: totalB,
      changes,
    };
  }

  // Iterate over all unique composite keys. For each key, pair up items from
  // aArr and bArr by position; extras on either side are added/removed.
  for (const key of allKeys) {
    const aArr = aMap.get(key) ?? [];
    const bArr = bMap.get(key) ?? [];
    const maxLen = Math.max(aArr.length, bArr.length);

    for (let i = 0; i < maxLen; i++) {
      const a = aArr[i];
      const b = bArr[i];

      if (a && !b) {
        const totalA = a.plans.reduce((s, p) => s + p.plannedAmount, 0);
        diffLines.push({
          status: "removed",
          lineItem: a.lineItem,
          category: a.category,
          subcategory: a.subcategory,
          totalBudgetA: totalA,
          totalBudgetB: null,
          changes: [],
        });
      } else if (!a && b) {
        const totalB = b.plans.reduce((s, p) => s + p.plannedAmount, 0);
        diffLines.push({
          status: "added",
          lineItem: b.lineItem,
          category: b.category,
          subcategory: b.subcategory,
          totalBudgetA: null,
          totalBudgetB: totalB,
          changes: [],
        });
      } else if (a && b) {
        diffLines.push(comparePair(a, b));
      }
    }
  }

  // Sort: added/removed/changed first, then by category + lineItem
  diffLines.sort((x, y) => {
    const order: Record<string, number> = { added: 0, removed: 1, changed: 2, unchanged: 3 };
    const diff = order[x.status] - order[y.status];
    if (diff !== 0) return diff;
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

  res.json({ snapshotA: aMeta, snapshotB: bMeta, lines: diffLines, summary });
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

  // Save pre-restore snapshot before touching DB — abort restore if this fails
  let preRestoreMeta: SnapshotMeta;
  try {
    const result = await captureSnapshot("pre-restore");
    preRestoreMeta = result.meta;
  } catch (e) {
    logger.error({ err: e }, "Pre-restore snapshot failed — aborting restore to preserve data safety");
    res.status(500).json({ error: "Could not save pre-restore backup. Restore aborted to protect your data." });
    return;
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

  logger.info({ filename, preRestoreId: preRestoreMeta.id }, "Snapshot restored");

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

// ─── PATCH /snapshots/:id/pin ─────────────────────────────────────────────────

router.patch("/snapshots/:id/pin", asyncHandler(async (req, res): Promise<void> => {
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
  if (typeof req.body?.pinned !== "boolean") {
    res.status(400).json({ error: "Request body must include a boolean 'pinned' field" });
    return;
  }
  const pinned: boolean = req.body.pinned;
  body.pinned = pinned;
  const filepath = path.join(SNAPSHOTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(body, null, 2), "utf-8");
  logger.info({ filename, pinned }, "Snapshot pin state updated");
  res.json(parseMeta(filename, body));
}));

export default router;
