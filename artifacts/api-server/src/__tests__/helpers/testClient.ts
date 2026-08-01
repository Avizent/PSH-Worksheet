import request from "supertest";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import app from "../../app";

/**
 * The API is gated globally (see middleware/requireAuth.ts), so tests have to
 * sign in like a real client does.
 *
 * Each call creates its own throwaway account with a random address rather
 * than reusing a seeded one: test files run in parallel workers against the
 * same database, and sharing a fixed account would let one file's cleanup
 * delete a row another file is still using. It also means running the suite
 * never touches a real user's credentials.
 */
const TEST_PASSWORD = "vitest-suite-password";

let token = "";
let testEmail = "";

export async function loginForTests(): Promise<void> {
  testEmail = `vitest-${crypto.randomUUID()}@example.invalid`;
  // Cost 4 rather than the production 12 — this runs on every test file and
  // the hash never leaves the test database.
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);

  await db.insert(usersTable).values({
    email: testEmail,
    name: "Vitest",
    role: "admin",
    passwordHash,
  });

  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: testEmail, password: TEST_PASSWORD });

  if (res.status !== 200 || !res.body?.token) {
    throw new Error(`Test login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  token = res.body.token;
}

export async function cleanupTestUser(): Promise<void> {
  if (!testEmail) return;
  await db.delete(usersTable).where(eq(usersTable.email, testEmail));
  testEmail = "";
  token = "";
}

type Method = "get" | "post" | "put" | "patch" | "delete";

function authed(method: Method) {
  return (url: string) => request(app)[method](url).set("x-user-session", token);
}

/**
 * Drop-in replacement for `request(app)` that carries the test session.
 * Returns supertest Test objects, so .send/.attach/.expect chain as before.
 */
export function req() {
  return {
    get: authed("get"),
    post: authed("post"),
    put: authed("put"),
    patch: authed("patch"),
    delete: authed("delete"),
  };
}
