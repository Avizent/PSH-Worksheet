import { type Request, type Response, type NextFunction } from "express";
import { getUserSession, isValidUserSession } from "../routes/userAuth";
import { isValidVpSession } from "./vpAuth";
import { runWithRequestContext } from "./requestContext";

/**
 * Endpoints reachable without a session. Everything else mounted under /api is
 * gated by requireAuth below.
 *
 * Keep this list short and justify every entry — it is the entire public
 * attack surface of the API. Match is exact on method + path (no prefixes), so
 * a new route cannot become public by accident.
 */
const PUBLIC_ENDPOINTS: ReadonlyArray<readonly [method: string, path: string]> = [
  // Liveness/readiness probe. Reports schema + DB reachability only.
  ["GET", "/healthz"],

  // The auth handshake itself. Each of these gates its own credentials and
  // returns 401 on its own when they are missing or wrong.
  ["POST", "/auth/login"],
  ["POST", "/auth/logout"],
  ["GET", "/auth/me"],
  ["POST", "/auth/vp-login"],

  // Share-link endpoints for external board members, who have no account.
  // Each validates a share token from ?token= (see validateToken in
  // routes/board.ts) and 401s without a valid, unrevoked, unexpired one.
  ["GET", "/board/view"],
  ["GET", "/exports/pdf"],
  ["GET", "/exports/excel"],
];

function isPublic(method: string, path: string): boolean {
  return PUBLIC_ENDPOINTS.some(([m, p]) => m === method && p === path);
}

/**
 * Global gate for /api. Accepts a signed-in user session or a VP API-key
 * session; anything else gets 401 before it reaches a route handler.
 *
 * Previously the API was entirely unauthenticated — the login screen was a
 * client-side redirect only, so the full budget (and every mutating and
 * destructive endpoint) was readable and writable by anyone who could reach
 * the server.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isPublic(req.method, req.path)) {
    next();
    return;
  }

  const userSession = req.headers["x-user-session"];
  if (typeof userSession === "string" && isValidUserSession(userSession)) {
    const session = getUserSession(userSession);
    res.locals.authUser = session;
    // Makes the user ambient for the rest of the request so audit writes can
    // attribute themselves without every call site threading an id through.
    runWithRequestContext({ userId: session?.userId ?? null }, () => next());
    return;
  }

  const vpSession = req.headers["x-vp-session"];
  if (typeof vpSession === "string" && isValidVpSession(vpSession)) {
    res.locals.authVp = true;
    // VP sessions are API-key logins with no user record behind them.
    runWithRequestContext({ userId: null }, () => next());
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}

/**
 * Stricter gate for destructive, non-recoverable operations (wipe-and-reseed,
 * clear-all). Requires a signed-in user whose role is "admin".
 *
 * Deliberately does NOT accept a VP session: the VP API key is baked into the
 * web bundle at build time, so treating it as an admin credential would put
 * database-wiping behind a key that ships to every client.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-user-session"];
  const session = typeof token === "string" ? getUserSession(token) : null;

  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (session.role !== "admin") {
    res.status(403).json({ error: "This operation requires an admin account" });
    return;
  }

  res.locals.authUser = session;
  next();
}
