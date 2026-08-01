import { pool } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { markSchemaReady } from "./lib/readiness";
import { runSchemaMigrations } from "./lib/runSchemaMigrations";
import { seedAuthUsers } from "./lib/seedAuthUsers";
import { seedBudgetData } from "./lib/seedBudgetData";
import { startScheduler } from "./lib/scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  try {
    await runSchemaMigrations();
    markSchemaReady();
  } catch (e) {
    logger.error({ err: e }, "Failed to run schema migrations");
  }

  try {
    await seedAuthUsers();
    logger.info("Auth users seeded");
  } catch (e) {
    logger.error({ err: e }, "Failed to seed auth users");
  }

  try {
    await seedBudgetData();
  } catch (e) {
    logger.error({ err: e }, "Failed to seed budget data");
  }

  // runStartupMigration() is deliberately NOT called here. It re-inserted seed
  // lines keyed on mutable owner/region fields, so every restart after an edit
  // or a deletion resurrected the line with hardcoded figures. Run it manually
  // with ALLOW_SEED_BACKFILL=1 if a genuine backfill is ever needed.

  startScheduler();
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  server.close(() => {
    pool
      .end()
      .catch((e) => logger.error({ err: e }, "Error closing database pool"))
      .finally(() => process.exit(0));
  });

  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
