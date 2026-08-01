import { Client } from "pg";

export type ConnectionTestResult = { ok: true } | { ok: false; error: string };

// Supabase (and most managed Postgres hosts) require SSL but sign certs
// with a CA Node doesn't trust by default; a bare Client() against them
// either hangs or fails with a cryptic self-signed-cert error. Only skip
// this for local/loopback hosts, which typically don't run SSL at all.
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

// Node's dual-stack (happy-eyeballs) connection to hosts like "localhost"
// that resolve to multiple addresses throws an AggregateError whose own
// .message is empty - the real per-attempt errors live in .errors[].
function describeError(e: unknown): string {
  if (e instanceof AggregateError && e.errors.length > 0) {
    return e.errors.map((inner) => describeError(inner)).join("; ");
  }
  if (e instanceof Error && e.message) {
    return e.message;
  }
  return String(e);
}

export async function testConnection(
  connectionString: string,
): Promise<ConnectionTestResult> {
  let client: Client;
  try {
    client = new Client({
      connectionString,
      connectionTimeoutMillis: 8000,
      ssl: resolveSslOption(connectionString),
    });
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }

  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  } finally {
    await client.end().catch(() => {});
  }
}
