import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

interface UserSession {
  token: string;
  userId: number;
  email: string;
  name: string | null;
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

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
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

  cleanExpiredSessions();
  const token = crypto.randomBytes(32).toString("hex");
  userSessions.set(token, {
    token,
    userId: user.id,
    email: user.email ?? "",
    name: user.name,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

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

export function isValidUserSession(token: string): boolean {
  const session = userSessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    userSessions.delete(token);
    return false;
  }
  return true;
}

export default router;
