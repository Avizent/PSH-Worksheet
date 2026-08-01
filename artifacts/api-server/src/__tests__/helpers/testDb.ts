import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@workspace/db/schema";

/**
 * Stand-in for `@workspace/db` used by the test suite. vitest.config.ts aliases
 * `@workspace/db` to this module, so both the tests and the route code under
 * test talk to an in-process Postgres instead of a real server.
 *
 * PGlite is genuine Postgres compiled to WASM, not a mock or an emulation
 * layer: transactions, foreign keys, unique indexes and `numeric` arithmetic
 * all behave as they do in production. That matters here — several of the
 * defects these tests cover are constraint and transaction behaviour, which a
 * mocked driver would not reproduce.
 *
 * The database is in-memory and lives for the run, so it needs nothing from
 * the developer's machine and cannot touch the real one.
 */
const client = new PGlite();

export const db = drizzle(client, { schema });

/**
 * The real module exports a pg Pool; `pool.end()` is called in test teardown.
 * Closing here would break every later test file, since all files share this
 * one instance, so it is deliberately a no-op. The process exits when vitest
 * finishes and the memory goes with it.
 */
export const pool = {
  end: async (): Promise<void> => {},
};

export * from "@workspace/db/schema";

// src/__tests__/helpers → lib/db/drizzle
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../../../lib/db/drizzle");

let migrated: Promise<void> | null = null;

/** Applies the real Drizzle migrations. Safe to call repeatedly. */
export function migrateTestDb(): Promise<void> {
  if (!migrated) {
    migrated = migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  }
  return migrated;
}
