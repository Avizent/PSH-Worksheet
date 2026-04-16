import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const AUTH_USERS = [
  {
    email: "rcp@avizent.com",
    name: "Patricia C.",
    password: "Patricia1!",
    role: "admin",
  },
  {
    email: "patricia.s.hyde@gmail.com",
    name: "Patricia H.",
    password: "Patricia1!",
    role: "editor",
  },
];

export async function seedAuthUsers(): Promise<void> {
  for (const u of AUTH_USERS) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, u.email))
      .limit(1);

    const passwordHash = await bcrypt.hash(u.password, 12);

    if (existing) {
      await db
        .update(usersTable)
        .set({ passwordHash, name: u.name, role: u.role })
        .where(eq(usersTable.email, u.email));
    } else {
      await db.insert(usersTable).values({
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
      });
    }
    logger.info({ email: u.email }, "Auth user seeded");
  }
}
