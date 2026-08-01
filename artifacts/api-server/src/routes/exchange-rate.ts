import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { db, exchangeRatesTable } from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { writeAuditLog } from "../middleware/auditLog";
import { logger } from "../lib/logger";
import { createSnapshot } from "./snapshots";

const router: IRouter = Router();

const SetRateBodySchema = z.object({
  rate: z.number().positive().finite(),
  source: z.enum(["manual", "lookup"]).default("manual"),
  note: z.string().max(500).nullable().optional(),
});

/** Newest row wins; null when no rate has ever been configured. */
export async function getActiveRate(): Promise<number | null> {
  const [row] = await db
    .select()
    .from(exchangeRatesTable)
    .orderBy(desc(exchangeRatesTable.createdAt), desc(exchangeRatesTable.id))
    .limit(1);
  return row ? row.rate : null;
}

router.get("/exchange-rate", asyncHandler(async (_req, res): Promise<void> => {
  const history = await db
    .select()
    .from(exchangeRatesTable)
    .orderBy(desc(exchangeRatesTable.createdAt), desc(exchangeRatesTable.id))
    .limit(25);
  res.json({ active: history[0] ?? null, history });
}));

router.get("/exchange-rate/lookup", asyncHandler(async (_req, res): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=GBP&symbols=SEK", {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Rate service returned ${response.status}`);
    const body = (await response.json()) as { rates?: { SEK?: number }; date?: string };
    const rate = body.rates?.SEK;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("Rate service returned no usable SEK rate");
    }
    res.json({ rate, date: body.date ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, "Exchange rate lookup failed");
    res.status(502).json({
      error: `Could not fetch the current rate (${message}). Enter it manually instead.`,
    });
  } finally {
    clearTimeout(timeout);
  }
}));

router.post("/exchange-rate", asyncHandler(async (req, res): Promise<void> => {
  const parsed = SetRateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const previous = await getActiveRate();
  const { rate, source, note } = parsed.data;

  // Snapshot before the change: a rate change alters every GBP figure the
  // directors see, so it gets the same restore point as any bulk data edit.
  let snapshotId: string | null = null;
  try {
    const snap = await createSnapshot(`rate-change-${previous ?? "none"}-to-${rate}`);
    snapshotId = snap.id;
  } catch (e) {
    logger.warn({ err: e }, "Snapshot before rate change failed; continuing");
  }

  const [created] = await db
    .insert(exchangeRatesTable)
    .values({ rate, source, note: note ?? null })
    .returning();

  await writeAuditLog({
    action: "update",
    entityType: "exchange_rate",
    entityId: created.id,
    field: "rate",
    oldValue: previous !== null ? String(previous) : null,
    newValue: String(rate),
  });

  res.json({ active: created, snapshotId });
}));

export default router;
