import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { isValidUserSession } from "../routes/userAuth";

interface VpSession {
  token: string;
  expiresAt: number;
}

const vpSessions = new Map<string, VpSession>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [key, session] of vpSessions) {
    if (session.expiresAt < now) vpSessions.delete(key);
  }
}

export function vpLogin(req: Request, res: Response): void {
  const vpApiKey = process.env.VP_API_KEY;
  if (!vpApiKey) {
    res.status(500).json({ error: "VP_API_KEY not configured" });
    return;
  }
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (apiKey !== vpApiKey) {
    res.status(401).json({ error: "Invalid VP API key" });
    return;
  }
  cleanExpiredSessions();
  const sessionToken = crypto.randomBytes(32).toString("hex");
  vpSessions.set(sessionToken, {
    token: sessionToken,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  res.json({ sessionToken, expiresIn: SESSION_TTL_MS / 1000 });
}

export function isValidVpSession(token: string): boolean {
  const session = vpSessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    vpSessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Accepts either a VP session (API-key login, used by external board members)
 * or a normal signed-in user session.
 *
 * The VP key path only ever worked in the hosted Replit deployment, where
 * EXPO_PUBLIC_VP_API_KEY was baked into the web bundle at build time. The
 * desktop build has no such key, so requiring it exclusively left board
 * settings, share links, exports, rollover and reforecast permanently 401ing
 * for the signed-in budget holder. Same dual-auth check already used by
 * /snapshots/compare/pdf.
 */
export function requireVpAuth(req: Request, res: Response, next: NextFunction): void {
  const vpSession = req.headers["x-vp-session"] as string | undefined;
  if (vpSession && isValidVpSession(vpSession)) {
    next();
    return;
  }
  const userSession = req.headers["x-user-session"] as string | undefined;
  if (userSession && isValidUserSession(userSession)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized: sign in or provide a valid VP session" });
}
