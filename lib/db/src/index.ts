import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Supabase (and most managed Postgres hosts) require SSL but sign certs
// with a CA Node doesn't trust by default; connecting without this either
// hangs or fails with a self-signed-cert error. Only skip it for
// local/loopback hosts, which typically don't run SSL at all.
function resolveSslOption(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  try {
    const { hostname } = new URL(connectionString);
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return undefined;
    }
    return { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSslOption(process.env.DATABASE_URL),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
