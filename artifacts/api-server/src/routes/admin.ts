import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  auditLogsTable,
} from "@workspace/db";
import { AnnualRolloverBody } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireVpAuth } from "../middleware/vpAuth";
import { requireAdmin } from "../middleware/requireAuth";
import { getCurrentUserId } from "../middleware/requestContext";

const router: IRouter = Router();

// Admin-only: rollover rewrites a whole year of plans across every line.
// requireVpAuth accepts any signed-in user (and the VP key that ships in the
// web bundle), which is not a strong enough gate for a bulk year-level write.
router.post("/admin/rollover", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
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

  // One transaction: a rollover that failed half-way used to leave the target
  // year holding some lines' plans and not others, while still reporting an
  // error — and the 409 guard above would then refuse to retry it, because
  // plans "already exist" for that year.
  await db.transaction(async (tx) => {
    if (newPlans.length > 0) {
      await tx.insert(monthlyPlansTable).values(newPlans);
      monthlyPlansCreated = newPlans.length;
    }

    // Deliberately no zero-value actuals. Rollover used to fabricate twelve
    // per budget line, which achieved nothing — spend of zero is the absence
    // of a row — and actively broke the next real import, because those
    // placeholder rows occupied every (line, month, year) slot the unique
    // index allows, so the first genuine actual for the year collided.

    await tx.insert(auditLogsTable).values({
      action: "rollover",
      entityType: "annual_rollover",
      entityId: 0,
      field: "year",
      oldValue: String(sourceYear),
      newValue: String(targetYear),
      userId: getCurrentUserId(),
    });
  });

  res.json({
    sourceYear,
    targetYear,
    budgetLinesCopied: budgetLines.length,
    monthlyPlansCreated,
    monthlyActualsCreated: 0,
  });
}));

export default router;
