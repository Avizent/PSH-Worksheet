import { createSnapshot } from "../routes/snapshots";
import { logger } from "./logger";

const NIGHTLY_HOUR = 2;
const NIGHTLY_MINUTE = 0;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(NIGHTLY_HOUR, NIGHTLY_MINUTE, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runNightlySnapshot(): Promise<void> {
  logger.info("Running nightly snapshot");
  try {
    const meta = await createSnapshot("nightly");
    logger.info({ snapshotId: meta.id }, "Nightly snapshot saved");
  } catch (err) {
    logger.error({ err }, "Nightly snapshot failed");
  }
}

let schedulerStarted = false;

function scheduleNext(): void {
  const delayMs = msUntilNextRun();
  const nextRun = new Date(Date.now() + delayMs);
  logger.info({ nextRun: nextRun.toISOString() }, "Next nightly snapshot scheduled");
  setTimeout(() => {
    void runNightlySnapshot().finally(() => scheduleNext());
  }, delayMs);
}

export function startScheduler(): void {
  if (schedulerStarted) {
    logger.warn("startScheduler() called more than once — ignoring duplicate call");
    return;
  }
  schedulerStarted = true;
  scheduleNext();
}
