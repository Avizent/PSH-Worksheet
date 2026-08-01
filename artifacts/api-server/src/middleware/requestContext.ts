import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  userId: number | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` (and everything it awaits) with the given request context. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * The signed-in user for the request currently being handled, or null outside
 * a request (scheduler jobs, boot-time seeding) and on unauthenticated routes.
 *
 * Ambient rather than threaded through call arguments because writeAuditLog is
 * invoked from ~30 places across the routes, none of which passed a user id —
 * every audit row was being written with user_id NULL, so the log recorded
 * what changed but never who changed it.
 */
export function getCurrentUserId(): number | null {
  return storage.getStore()?.userId ?? null;
}
