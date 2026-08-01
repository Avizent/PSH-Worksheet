import { migrateTestDb } from "./testDb";
import { seedBudgetData } from "../../lib/seedBudgetData";

/**
 * vitest `setupFiles` entry: brings the in-process test database up to the
 * current schema and populates the baseline budget the existing tests assume
 * ("No budget lines in DB — seed data first").
 *
 * Imported here rather than inside testDb.ts on purpose: seedBudgetData
 * imports `@workspace/db`, which is aliased back to testDb, and doing it the
 * other way round would make that a cycle.
 */
let prepared: Promise<void> | null = null;

async function prepare(): Promise<void> {
  await migrateTestDb();
  // Idempotent: returns early when budget lines already exist.
  await seedBudgetData();
}

export async function setup(): Promise<void> {
  if (!prepared) prepared = prepare();
  await prepared;
}

await setup();
