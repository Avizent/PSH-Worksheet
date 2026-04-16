import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";

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

export function requireVpAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionToken = req.headers["x-vp-session"] as string | undefined;
  if (sessionToken && isValidVpSession(sessionToken)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized: valid VP session required" });
}
