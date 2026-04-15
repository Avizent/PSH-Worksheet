import { Router, type IRouter } from "express";
import { eq, isNull, isNotNull } from "drizzle-orm";
import { db, alertsTable } from "@workspace/db";
import {
  ResolveAlertParams,
  ListAlertsResponse,
  ResolveAlertResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get("/alerts", asyncHandler(async (req, res): Promise<void> => {
  const resolvedParam = req.query.resolved;
  let rows;
  if (resolvedParam === "true") {
    rows = await db.select().from(alertsTable).where(isNotNull(alertsTable.resolvedAt)).orderBy(alertsTable.createdAt);
  } else if (resolvedParam === "false") {
    rows = await db.select().from(alertsTable).where(isNull(alertsTable.resolvedAt)).orderBy(alertsTable.createdAt);
  } else if (resolvedParam === undefined) {
    rows = await db.select().from(alertsTable).orderBy(alertsTable.createdAt);
  } else {
    res.status(400).json({ error: "resolved must be 'true' or 'false'" });
    return;
  }
  res.json(ListAlertsResponse.parse(rows));
}));

router.patch("/alerts/:id/resolve", asyncHandler(async (req, res): Promise<void> => {
  const params = ResolveAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.update(alertsTable).set({ resolvedAt: new Date() }).where(eq(alertsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.json(ResolveAlertResponse.parse(row));
}));

export default router;
