import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Accounts this server guarantees exist. Passwords are NOT stored here — they
 * come from the environment.
 *
 * This previously held a plaintext password in source (committed to git) and
 * re-hashed it into the database on every single boot, which meant the
 * credential could not be changed: any rotation was undone by the next
 * restart. Now the hash is written only when the account is first created, or
 * when the operator explicitly supplies a new password via the environment.
 */
const AUTH_USERS = [
  {
    email: "rcp@avizent.com",
    name: "Patricia C.",
    role: "admin",
    passwordEnvVar: "SEED_PASSWORD_ADMIN",
  },
  {
    email: "patricia.s.hyde@gmail.com",
    name: "Patricia H.",
    role: "editor",
    passwordEnvVar: "SEED_PASSWORD_EDITOR",
  },
];

const BCRYPT_COST = 12;

export async function seedAuthUsers(): Promise<void> {
  for (const u of AUTH_USERS) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, u.email))
      .limit(1);

    const suppliedPassword = process.env[u.passwordEnvVar]?.trim();

    if (existing) {
      // Keep name/role in step with this file, but never silently overwrite a
      // password the user may have rotated.
      await db
        .update(usersTable)
        .set({ name: u.name, role: u.role })
        .where(eq(usersTable.email, u.email));

      if (suppliedPassword) {
        await db
          .update(usersTable)
          .set({ passwordHash: await bcrypt.hash(suppliedPassword, BCRYPT_COST) })
          .where(eq(usersTable.email, u.email));
        logger.warn(
          { email: u.email, envVar: u.passwordEnvVar },
          "Password reset from environment. Unset this variable once the new password is in use, " +
            "or it will be re-applied on every restart.",
        );
      }
      continue;
    }

    // New account. Use the supplied password if there is one; otherwise mint a
    // random one and print it once, so a fresh install is reachable without
    // shipping a default credential in source.
    const password = suppliedPassword ?? crypto.randomBytes(18).toString("base64url");
    await db.insert(usersTable).values({
      email: u.email,
      name: u.name,
      role: u.role,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    });

    if (suppliedPassword) {
      logger.info({ email: u.email }, "Auth user created with password from environment");
    } else {
      logger.warn(
        { email: u.email, password },
        "Auth user created with a generated password. Record it now — it is not stored anywhere " +
          "else and will not be shown again.",
      );
    }
  }
}
