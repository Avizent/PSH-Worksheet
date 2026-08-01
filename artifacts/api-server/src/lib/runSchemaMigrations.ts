import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Applies the Drizzle SQL migrations bundled alongside dist/index.mjs (copied
 * there by build.mjs from lib/db/drizzle) so a brand-new, empty database gets
 * its schema created before any seeding/queries run.
 */
export async function runSchemaMigrations(): Promise<void> {
  const migrationsFolder = path.join(__dirname, "drizzle");
  await migrate(db, { migrationsFolder });
  logger.info("Schema migrations applied");
}
