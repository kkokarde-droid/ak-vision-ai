import { eq } from "drizzle-orm";

import {
  db,
  userCredentials,
  users,
} from "@ak-vision-ai/database";

import { hashPassword } from "./common/auth/password.service.js";

const ADMIN_EMAIL = "admin-test@akvision.local";
const NEW_PASSWORD = "AKVisionAdmin123!";

async function main() {
  const normalizedEmail = ADMIN_EMAIL.trim().toLowerCase();

  console.log(`Looking for user: ${normalizedEmail}`);

  const result = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  const user = result[0];

  if (!user) {
    throw new Error(
      `User not found: ${normalizedEmail}`,
    );
  }

  console.log("Found user:", user);

  if (
    user.role !== "admin" &&
    user.role !== "super_admin"
  ) {
    throw new Error(
      `User is not an admin. Current role: ${user.role}`,
    );
  }

  if (user.status !== "active") {
    throw new Error(
      `Admin account is not active. Current status: ${user.status}`,
    );
  }

  const passwordHash =
    await hashPassword(NEW_PASSWORD);

  const credentialResult = await db
    .insert(userCredentials)
    .values({
      userId: user.id,
      passwordHash,
    })
    .onConflictDoUpdate({
      target: userCredentials.userId,
      set: {
        passwordHash,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: userCredentials.id,
      userId: userCredentials.userId,
    });

  console.log(
    "Password credential created/updated:",
    credentialResult[0],
  );

  console.log("");
  console.log("========================================");
  console.log("ADMIN PASSWORD RESET SUCCESSFUL");
  console.log("========================================");
  console.log(`Email:    ${normalizedEmail}`);
  console.log(`Password: ${NEW_PASSWORD}`);
  console.log(`Role:     ${user.role}`);
  console.log(`Status:   ${user.status}`);
  console.log("========================================");
}

main()
  .catch((error) => {
    console.error("");
    console.error("ADMIN PASSWORD RESET FAILED");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    process.exit(0);
  });