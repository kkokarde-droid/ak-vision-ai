import { eq } from "drizzle-orm";

import {
  db,
  userCredentials,
  users,
} from "@ak-vision-ai/database";

import {
  getOrCreateCreditBalanceTx,
} from "@ak-vision-ai/credits";

import {
  hashPassword,
  verifyPassword,
} from "../../common/auth/password.service.js";

import {
  createSession,
  revokeAllUserSessions,
} from "../../common/auth/session.service.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sanitizeUser(
  user: typeof users.$inferSelect,
) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    accountType: user.accountType,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName: string;
  accountType?:
    | "individual"
    | "business"
    | "enterprise";
}) {
  const email = normalizeEmail(input.email);
  const password = input.password;
  const displayName = input.displayName.trim();

  if (!email || !password || !displayName) {
    throw new Error(
      "email, password and displayName are required",
    );
  }

  const existing = await db
    .select({
      id: users.id,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing[0]) {
    throw new Error(
      "An account with this email already exists",
    );
  }

  const passwordHash =
    await hashPassword(password);

  const user = await db.transaction(
    async (tx) => {
      const userResult = await tx
        .insert(users)
        .values({
          email,
          displayName,
          status: "active",
          role: "customer",
          accountType:
            input.accountType ?? "individual",
        })
        .returning();

      const createdUser = userResult[0];

      if (!createdUser) {
        throw new Error(
          "Failed to create user",
        );
      }

      await tx
        .insert(userCredentials)
        .values({
          userId: createdUser.id,
          passwordHash,
        });
      /*
       * Provision the customer's individual credit account
       * inside the SAME transaction as user creation and
       * password credential creation.
       */
      await getOrCreateCreditBalanceTx(
        tx,
        {
          userId:
            createdUser.id,
        },
      );

      return createdUser;
    },
  );

  const session = await createSession(
    user.id,
  );

  return {
    user: sanitizeUser(user),
    session,
  };
}

export async function loginUser(input: {
  email: string;
  password: string;
}) {
  const email = normalizeEmail(input.email);

  if (!email || !input.password) {
    throw new Error(
      "Invalid email or password",
    );
  }

  const result = await db
    .select({
      user: users,
      credential: userCredentials,
    })
    .from(users)
    .innerJoin(
      userCredentials,
      eq(
        userCredentials.userId,
        users.id,
      ),
    )
    .where(eq(users.email, email))
    .limit(1);

  const record = result[0];

  if (!record) {
    throw new Error(
      "Invalid email or password",
    );
  }

  const user = record.user;

  if (
    user.status === "suspended" ||
    user.status === "deleted"
  ) {
    throw new Error(
      "Account is not available",
    );
  }

  const valid = await verifyPassword(
    input.password,
    record.credential.passwordHash,
  );

  if (!valid) {
    throw new Error(
      "Invalid email or password",
    );
  }

  const session = await createSession(
    user.id,
  );

  return {
    user: sanitizeUser(user),
    session,
  };
}

export async function logoutAllUserSessions(
  userId: string,
): Promise<number> {
  return revokeAllUserSessions(userId);
}