import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import {
  authSessions,
  db,
  passwordResetTokens,
  userCredentials,
  users,
} from "@ak-vision-ai/database";

import { buildApp } from "../../app.js";
import { createSession } from "../../common/auth/session.service.js";
import { hashPassword, verifyPassword } from "../../common/auth/password.service.js";

let app: ReturnType<typeof buildApp>;

async function createCustomer() {
  const userResult = await db
    .insert(users)
    .values({
      email: `password-reset-${randomUUID()}@example.test`,
      displayName: "Password Reset Customer",
      role: "customer",
      status: "active",
      accountType: "individual",
    })
    .returning({ id: users.id });

  const user = userResult[0];
  assert.ok(user);

  await db.insert(userCredentials).values({
    userId: user.id,
    passwordHash: await hashPassword("OldPassword123!"),
  });

  const session = await createSession(user.id);
  assert.ok(session);

  return {
    userId: user.id,
    email: user.email,
    token: session.token,
  };
}

async function cleanup(userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx.delete(userCredentials).where(eq(userCredentials.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

test("forgot password does not reveal whether an account exists", async () => {
  const fixture = await createCustomer();

  try {
    const known = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: fixture.email },
    });

    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: `missing-${randomUUID()}@example.test` },
    });

    assert.equal(known.statusCode, 200);
    assert.equal(unknown.statusCode, 200);
    assert.equal(known.json().message, unknown.json().message);
  } finally {
    await cleanup(fixture.userId);
  }
});

test("password reset changes password, consumes token, and revokes sessions", async () => {
  const fixture = await createCustomer();
  const rawToken = `reset-${randomUUID()}`;
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");

  try {
    await db.insert(passwordResetTokens).values({
      userId: fixture.userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: {
        token: rawToken,
        newPassword: "NewPassword456!",
      },
    });

    assert.equal(response.statusCode, 200);

    const credential = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, fixture.userId))
      .limit(1);

    assert.equal(credential.length, 1);
    assert.equal(
      await verifyPassword("NewPassword456!", credential[0]!.passwordHash),
      true,
    );

    const sessions = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, fixture.userId));

    assert.ok(sessions.every((session) => session.revokedAt !== null));

    const unusedToken = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, fixture.userId),
          eq(passwordResetTokens.tokenHash, tokenHash),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    assert.equal(unusedToken.length, 0);
  } finally {
    await cleanup(fixture.userId);
  }
});

test("used password reset token cannot be reused", async () => {
  const fixture = await createCustomer();
  const rawToken = `reset-${randomUUID()}`;

  try {
    await db.insert(passwordResetTokens).values({
      userId: fixture.userId,
      tokenHash: createHash("sha256").update(rawToken, "utf8").digest("hex"),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: {
        token: rawToken,
        newPassword: "NewPassword789!",
      },
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: {
        token: rawToken,
        newPassword: "AnotherPassword789!",
      },
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 400);
  } finally {
    await cleanup(fixture.userId);
  }
});
