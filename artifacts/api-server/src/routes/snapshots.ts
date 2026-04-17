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
} from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { logger } from "../lib/logger";

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
  // embedded after joining from flat arrays
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

/** Parsed content of a snapshot JSON file with plans/actuals joined into budget lines */
interface SnapshotBody {
  id: string;
  label: string;
  createdAt: string;
  pinned?: boolean;
  budgetLines: SnapshotBudgetLine[];
  owners: SnapshotOwner[];
  categories: SnapshotCategory[];
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
        budgetLines: Omit<SnapshotBudgetLine, "plans" | "actuals">[];
        monthlyPlans: SnapshotPlan[];
        monthlyActuals: SnapshotActual[];
        owners?: SnapshotOwner[];
        categories?: SnapshotCategory[];
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

  const [budgetLines, monthlyPlans, monthlyActuals, owners, categories] = await Promise.all([
    db.select().from(budgetLinesTable),
    db.select().from(monthlyPlansTable),
    db.select().from(monthlyActualsTable),
    db.select().from(ownersTable).orderBy(ownersTable.id),
    db.select().from(categoriesTable).orderBy(categoriesTable.id),
  ]);

  const snap = {
    id,
    label,
    createdAt: now.toISOString(),
    pinned: false,
    data: { budgetLines, monthlyPlans, monthlyActuals, owners, categories },
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

    const aFile = idFromStem(aId);
    const bFile = idFromStem(bId);

    if (
      aFile.includes("..") ||
      aFile.includes("/") ||
      bFile.includes("..") ||
      bFile.includes("/")
    ) {
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

    // Build lookup maps keyed by composite identifying fields to avoid collisions.
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

    interface DiffChange {
      field: string;
      from: string | null;
      to: string | null;
    }
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

    function comparePair(a: SnapshotBudgetLine, b: SnapshotBudgetLine): DiffLine {
      const totalA = a.plans.reduce((s, p) => s + p.plannedAmount, 0);
      const totalB = b.plans.reduce((s, p) => s + p.plannedAmount, 0);

      const changes: DiffChange[] = [];

      if (a.costStatus !== b.costStatus) {
        changes.push({ field: "costStatus", from: a.costStatus, to: b.costStatus });
      }
      if (a.projectionPct !== b.projectionPct) {
        changes.push({
          field: "projectionPct",
          from: String(a.projectionPct),
          to: String(b.projectionPct),
        });
      }
      if ((a.boardApprovedAmount ?? null) !== (b.boardApprovedAmount ?? null)) {
        changes.push({
          field: "boardApprovedAmount",
          from: a.boardApprovedAmount != null ? String(a.boardApprovedAmount) : null,
          to: b.boardApprovedAmount != null ? String(b.boardApprovedAmount) : null,
        });
      }

      const planKey = (p: SnapshotPlan) => `${p.year}-${String(p.month).padStart(2, "0")}`;
      const aPlans = new Map<string, SnapshotPlan>();
      for (const p of a.plans) aPlans.set(planKey(p), p);
      const bPlans = new Map<string, SnapshotPlan>();
      for (const p of b.plans) bPlans.set(planKey(p), p);

      const allPlanKeys = new Set([...aPlans.keys(), ...bPlans.keys()]);
      for (const pk of Array.from(allPlanKeys).sort()) {
        const av = aPlans.get(pk)?.plannedAmount ?? 0;
        const bv = bPlans.get(pk)?.plannedAmount ?? 0;
        if (av !== bv) {
          changes.push({ field: `plan:${pk}`, from: String(av), to: String(bv) });
        }
      }

      const actualKey = (act: SnapshotActual) =>
        `${act.year}-${String(act.month).padStart(2, "0")}`;
      const aActuals = new Map<string, SnapshotActual>();
      for (const act of a.actuals) aActuals.set(actualKey(act), act);
      const bActuals = new Map<string, SnapshotActual>();
      for (const act of b.actuals) bActuals.set(actualKey(act), act);

      const allActualKeys = new Set([...aActuals.keys(), ...bActuals.keys()]);
      for (const ak of Array.from(allActualKeys).sort()) {
        const av = aActuals.get(ak)?.actualAmount ?? 0;
        const bv = bActuals.get(ak)?.actualAmount ?? 0;
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

    diffLines.sort((x, y) => {
      const order: Record<string, number> = {
        added: 0,
        removed: 1,
        changed: 2,
        unchanged: 3,
      };
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
  }),
);

// ─── GET /snapshots/:id ───────────────────────────────────────────────────────

router.get(
  "/snapshots/:id",
  asyncHandler(async (req, res): Promise<void> => {
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

// ─── POST /snapshots/:id/restore ─────────────────────────────────────────────

router.post(
  "/snapshots/:id/restore",
  asyncHandler(async (req, res): Promise<void> => {
    const { id } = req.params;
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
      // Delete in FK order (csv_import_rows references budget_lines, must go first)
      await tx.delete(csvImportRowsTable);
      await tx.delete(csvImportsTable);
      await tx.delete(monthlyActualsTable);
      await tx.delete(monthlyPlansTable);
      await tx.delete(budgetLinesTable);
      await tx.delete(ownersTable);
      await tx.delete(categoriesTable);

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
          })
          .returning();
        lineIdMap.set(bl.id, inserted.id);
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
  }),
);

// ─── DELETE /snapshots/:id ────────────────────────────────────────────────────

router.delete(
  "/snapshots/:id",
  asyncHandler(async (req, res): Promise<void> => {
    const { id } = req.params;
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
    fs.unlinkSync(filepath);
    logger.info({ id }, "Snapshot deleted");
    res.status(204).send();
  }),
);

// ─── PATCH /snapshots/:id/pin ─────────────────────────────────────────────────

router.patch(
  "/snapshots/:id/pin",
  asyncHandler(async (req, res): Promise<void> => {
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
