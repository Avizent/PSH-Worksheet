import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { triggerAlertEvaluation } from "../lib/runAlertEvaluation";

const router = Router();

export interface UserSession {
  token: string;
  userId: number;
  email: string;
  name: string | null;
  role: string;
  expiresAt: number;
}

const userSessions = new Map<string, UserSession>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [key, session] of userSessions) {
    if (session.expiresAt < now) userSessions.delete(key);
  }
}

/**
 * Login throttle. Two problems without it: an attacker can grind passwords
 * unimpeded, and because bcrypt runs at cost 12 on the single Node event loop,
 * a burst of login attempts is also a cheap way to stall the whole API for
 * everyone else.
 *
 * Keyed on client IP and email together, so one attacker cannot lock a real
 * user out by exhausting the attempts on their address.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginRateLimited(key: string): boolean {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (v.resetAt < now) loginAttempts.delete(k);
  }
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

/** Clears the counter after a successful sign-in. */
function clearLoginAttempts(key: string): void {
  loginAttempts.delete(key);
}

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const rateKey = `${req.ip ?? "unknown"}|${email.toLowerCase().trim()}`;
  if (loginRateLimited(rateKey)) {
    res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  clearLoginAttempts(rateKey);
  cleanExpiredSessions();
  const token = crypto.randomBytes(32).toString("hex");
  userSessions.set(token, {
    token,
    userId: user.id,
    email: user.email ?? "",
    name: user.name,
    role: user.role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  triggerAlertEvaluation();
  res.json({ token, name: user.name, email: user.email });
});

router.post("/auth/logout", (req, res) => {
  const token = req.headers["x-user-session"] as string | undefined;
  if (token) userSessions.delete(token);
  res.json({ success: true });
});

router.get("/auth/me", (req, res) => {
  const token = req.headers["x-user-session"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const session = userSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) userSessions.delete(token);
    res.status(401).json({ error: "Session expired" });
    return;
  }
  res.json({ email: session.email, name: session.name });
});

/**
 * Returns the live session for a token, or null if it is unknown or expired.
 * Expired tokens are evicted on lookup, same as isValidUserSession.
 */
export function getUserSession(token: string): UserSession | null {
  const session = userSessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    userSessions.delete(token);
    return null;
  }
  return session;
}

export function isValidUserSession(token: string): boolean {
  return getUserSession(token) !== null;
}

export default router;
