import { Router, type IRouter } from "express";
import { eq, isNull, inArray, and } from "drizzle-orm";
import { db, inAppAlertsTable, eventTasksTable } from "@workspace/db";
import {
  ListInAppAlertsQueryParams,
  ListInAppAlertsResponse,
  MarkInAppAlertReadParams,
  MarkInAppAlertReadResponse,
  MarkAllInAppAlertsReadBody,
  MarkAllInAppAlertsReadResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get(
  "/in-app-alerts",
  asyncHandler(async (req, res): Promise<void> => {
    const queryParsed = ListInAppAlertsQueryParams.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({ error: queryParsed.error.message });
      return;
    }
    const { eventId, unread } = queryParsed.data;

    if (eventId != null) {
      const tasks = await db
        .select({ id: eventTasksTable.id })
        .from(eventTasksTable)
        .where(eq(eventTasksTable.eventId, eventId));
      const taskIds = tasks.map((t) => t.id);
      if (taskIds.length === 0) {
        res.json([]);
        return;
      }
      const conditions = unread
        ? and(inArray(inAppAlertsTable.taskId, taskIds), isNull(inAppAlertsTable.readAt))
        : inArray(inAppAlertsTable.taskId, taskIds);
      const rows = await db
        .select()
        .from(inAppAlertsTable)
        .where(conditions)
        .orderBy(inAppAlertsTable.createdAt);
      res.json(ListInAppAlertsResponse.parse(rows));
      return;
    }

    const rows = await db
      .select()
      .from(inAppAlertsTable)
      .where(unread ? isNull(inAppAlertsTable.readAt) : undefined)
      .orderBy(inAppAlertsTable.createdAt);
    res.json(ListInAppAlertsResponse.parse(rows));
  })
);

router.post(
  "/in-app-alerts/mark-all-read",
  asyncHandler(async (req, res): Promise<void> => {
    const parsed = MarkAllInAppAlertsReadBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const now = new Date();

    if (parsed.data.eventId != null) {
      const tasks = await db
        .select({ id: eventTasksTable.id })
        .from(eventTasksTable)
        .where(eq(eventTasksTable.eventId, parsed.data.eventId));
      const taskIds = tasks.map((t) => t.id);
      if (taskIds.length === 0) {
        res.json(MarkAllInAppAlertsReadResponse.parse({ updated: 0 }));
        return;
      }
      const updated = await db
        .update(inAppAlertsTable)
        .set({ readAt: now })
        .where(and(inArray(inAppAlertsTable.taskId, taskIds), isNull(inAppAlertsTable.readAt)))
        .returning({ id: inAppAlertsTable.id });
      res.json(MarkAllInAppAlertsReadResponse.parse({ updated: updated.length }));
      return;
    }

    const updated = await db
      .update(inAppAlertsTable)
      .set({ readAt: now })
      .where(isNull(inAppAlertsTable.readAt))
      .returning({ id: inAppAlertsTable.id });

    res.json(MarkAllInAppAlertsReadResponse.parse({ updated: updated.length }));
  })
);

router.patch(
  "/in-app-alerts/:id/read",
  asyncHandler(async (req, res): Promise<void> => {
    const params = MarkInAppAlertReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .update(inAppAlertsTable)
      .set({ readAt: new Date() })
      .where(eq(inAppAlertsTable.id, params.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }
    res.json(MarkInAppAlertReadResponse.parse(row));
  })
);

export default router;
