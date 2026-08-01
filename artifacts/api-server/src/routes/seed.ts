import { Router, type IRouter } from "express";
import { db, budgetLinesTable, monthlyPlansTable, monthlyActualsTable, alertsTable, eventsTable } from "@workspace/db";
import { csvImportRowsTable, csvImportsTable, forecastPlansTable, forecastVersionsTable, shareTokensTable, boardSettingsTable, auditLogsTable } from "@workspace/db";
import { SeedDataResponse } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAdmin } from "../middleware/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Admin-only: this deletes every row in twelve tables (including audit_logs)
// and re-seeds from the bundled fixture. Nothing in the app calls it.
router.post("/seed", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  logger.info("Manual seed triggered — clearing all data and re-seeding...");

  await db.delete(forecastPlansTable);
  await db.delete(forecastVersionsTable);
  await db.delete(monthlyActualsTable);
  await db.delete(csvImportRowsTable);
  await db.delete(csvImportsTable);
  await db.delete(alertsTable);
  await db.delete(eventsTable);
  await db.delete(shareTokensTable);
  await db.delete(boardSettingsTable);
  await db.delete(auditLogsTable);
  await db.delete(monthlyPlansTable);
  await db.delete(budgetLinesTable);

  const { seedBudgetDataForce } = await import("../lib/seedBudgetData");
  const stats = await seedBudgetDataForce();

  const result = {
    success: true,
    message: `Seeded ${stats.linesCreated} budget lines, ${stats.plansCreated} monthly plans, ${stats.actualsCreated} monthly actuals, ${stats.eventsCreated} events`,
    budgetLinesCreated: stats.linesCreated,
    monthlyPlansCreated: stats.plansCreated,
    monthlyActualsCreated: stats.actualsCreated,
  };

  res.json(SeedDataResponse.parse(result));
}));

export default router;
