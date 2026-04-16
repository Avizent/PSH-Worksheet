import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  auditLogsTable,
} from "@workspace/db";
import { AnnualRolloverBody } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireVpAuth } from "../middleware/vpAuth";

const router: IRouter = Router();

router.post("/admin/rollover", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = AnnualRolloverBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error });
    return;
  }

  const { sourceYear, targetYear } = parsed.data;

  if (targetYear <= sourceYear) {
    res.status(400).json({ error: "Target year must be after source year" });
    return;
  }

  const existingPlans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, targetYear));
  if (existingPlans.length > 0) {
    res.status(409).json({ error: `Monthly plans already exist for ${targetYear}. Rollover has already been done.` });
    return;
  }

  const budgetLines = await db.select().from(budgetLinesTable);
  const sourcePlans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, sourceYear));

  const newPlans = sourcePlans.map(p => ({
    budgetLineId: p.budgetLineId,
    month: p.month,
    year: targetYear,
    plannedAmount: p.plannedAmount,
  }));

  let monthlyPlansCreated = 0;
  if (newPlans.length > 0) {
    await db.insert(monthlyPlansTable).values(newPlans);
    monthlyPlansCreated = newPlans.length;
  }

  await db.insert(auditLogsTable).values({
    action: "rollover",
    entityType: "annual_rollover",
    entityId: 0,
    field: "year",
    oldValue: String(sourceYear),
    newValue: String(targetYear),
  });

  res.json({
    sourceYear,
    targetYear,
    budgetLinesCopied: budgetLines.length,
    monthlyPlansCreated,
  });
}));

export default router;
