import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { isSchemaReady } from "../lib/readiness";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  if (!isSchemaReady()) {
    res.status(503).json(HealthCheckResponse.parse({ status: "migrating" }));
    return;
  }
  try {
    await db.execute(sql`SELECT 1`);
    res.json(HealthCheckResponse.parse({ status: "ok" }));
  } catch {
    res.status(503).json(HealthCheckResponse.parse({ status: "error" }));
  }
});

export default router;
