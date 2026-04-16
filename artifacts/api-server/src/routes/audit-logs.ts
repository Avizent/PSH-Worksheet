import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireVpAuth } from "../middleware/vpAuth";

const router: IRouter = Router();

router.get("/audit-logs", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
  const { entityType, startDate, endDate } = req.query;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const offset = parseInt(req.query.offset as string) || 0;

  const conditions: any[] = [];
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType as string));
  if (startDate) conditions.push(gte(auditLogsTable.createdAt, new Date(startDate as string)));
  if (endDate) conditions.push(lte(auditLogsTable.createdAt, new Date(endDate as string)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [entries, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogsTable)
      .where(whereClause)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogsTable)
      .where(whereClause),
  ]);

  res.json({ entries, total: countResult[0]?.count ?? 0 });
}));

export default router;
