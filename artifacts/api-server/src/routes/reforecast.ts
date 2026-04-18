import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  forecastVersionsTable,
  forecastPlansTable,
  monthlyPlansTable,
  budgetLinesTable,
  auditLogsTable,
} from "@workspace/db";
import {
  CreateForecastVersionBody,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireVpAuth } from "../middleware/vpAuth";

const router: IRouter = Router();

router.get("/reforecast/versions", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
  const year = parseInt(req.query.year as string) || 2026;
  const versions = await db
    .select()
    .from(forecastVersionsTable)
    .where(eq(forecastVersionsTable.year, year))
    .orderBy(desc(forecastVersionsTable.versionNumber));

  if (versions.length === 0) {
    const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year));
    if (plans.length > 0) {
      const [original] = await db.insert(forecastVersionsTable).values({
        name: "Original Plan",
        versionNumber: 0,
        year,
        isOriginal: true,
      }).returning();

      const forecastPlanRows = plans.map(p => ({
        versionId: original.id,
        budgetLineId: p.budgetLineId,
        month: p.month,
        year: p.year,
        plannedAmount: p.plannedAmount,
      }));
      await db.insert(forecastPlansTable).values(forecastPlanRows);

      res.json([original]);
      return;
    }
  }

  res.json(versions);
}));

router.post("/reforecast/versions", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateForecastVersionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error });
    return;
  }

  const { name, description, plans, year: bodyYear } = parsed.data;
  const year = bodyYear ?? 2026;

  const existing = await db
    .select()
    .from(forecastVersionsTable)
    .where(eq(forecastVersionsTable.year, year))
    .orderBy(desc(forecastVersionsTable.versionNumber));

  const nextVersion = existing.length > 0 ? existing[0].versionNumber + 1 : 1;

  const [version] = await db.insert(forecastVersionsTable).values({
    name,
    description: description ?? null,
    versionNumber: nextVersion,
    year,
    isOriginal: false,
  }).returning();

  const forecastPlanRows = plans.map(p => ({
    versionId: version.id,
    budgetLineId: p.budgetLineId,
    month: p.month,
    year,
    plannedAmount: p.plannedAmount,
  }));
  await db.insert(forecastPlansTable).values(forecastPlanRows);

  await db.insert(auditLogsTable).values({
    action: "create",
    entityType: "forecast_version",
    entityId: version.id,
    field: "version",
    oldValue: null,
    newValue: `${name} (v${nextVersion})`,
  });

  res.status(201).json(version);
}));

router.get("/reforecast/versions/:id", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [version] = await db.select().from(forecastVersionsTable).where(eq(forecastVersionsTable.id, id));
  if (!version) {
    res.status(404).json({ error: "Version not found" });
    return;
  }
  const plans = await db.select().from(forecastPlansTable).where(eq(forecastPlansTable.versionId, id));
  res.json({ version, plans });
}));

router.get("/reforecast/compare", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
  const baseId = parseInt(req.query.baseVersionId as string);
  const compareId = parseInt(req.query.compareVersionId as string);

  const [baseVersion] = await db.select().from(forecastVersionsTable).where(eq(forecastVersionsTable.id, baseId));
  const [compareVersion] = await db.select().from(forecastVersionsTable).where(eq(forecastVersionsTable.id, compareId));

  if (!baseVersion || !compareVersion) {
    res.status(404).json({ error: "Version not found" });
    return;
  }

  const basePlans = await db.select().from(forecastPlansTable).where(eq(forecastPlansTable.versionId, baseId));
  const comparePlans = await db.select().from(forecastPlansTable).where(eq(forecastPlansTable.versionId, compareId));

  const budgetLines = await db.select().from(budgetLinesTable);
  const blMap = new Map(budgetLines.map(bl => [bl.id, bl]));

  const baseMap = new Map<string, number>();
  for (const p of basePlans) baseMap.set(`${p.budgetLineId}-${p.month}`, p.plannedAmount);

  const compareMap = new Map<string, number>();
  for (const p of comparePlans) compareMap.set(`${p.budgetLineId}-${p.month}`, p.plannedAmount);

  const allBudgetLineIds = new Set([...basePlans.map(p => p.budgetLineId), ...comparePlans.map(p => p.budgetLineId)]);

  const lines = Array.from(allBudgetLineIds).map(blId => {
    const bl = blMap.get(blId);
    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const key = `${blId}-${month}`;
      const basePlanned = baseMap.get(key) ?? 0;
      const comparePlanned = compareMap.get(key) ?? 0;
      return { month, basePlanned, comparePlanned, delta: comparePlanned - basePlanned };
    });
    return {
      budgetLineId: blId,
      lineItem: bl?.lineItem ?? "Unknown",
      category: bl?.category ?? "Unknown",
      months,
    };
  });

  res.json({ baseVersion, compareVersion, lines });
}));

export default router;
