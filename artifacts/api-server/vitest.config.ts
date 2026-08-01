import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Point the connection module at an in-process PGlite database, so the
      // suite runs anywhere without a Postgres server and can never reach the
      // real one. Anchored regex: `@workspace/db/schema` must still resolve to
      // the genuine schema module.
      {
        find: /^@workspace\/db$/,
        replacement: path.resolve(import.meta.dirname, "src/__tests__/helpers/testDb.ts"),
      },
    ],
  },
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    // One shared database for the run: the suite is written against a
    // persistent DB (files seed in one place and read in another), and
    // isolating module state per file would give each its own empty instance.
    isolate: false,
    setupFiles: ["./src/__tests__/helpers/setupTestDb.ts"],
    sequence: {
      concurrent: false,
    },
  },
});
