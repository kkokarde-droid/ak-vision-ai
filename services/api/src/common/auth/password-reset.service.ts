import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import {
  authSessions,
  db,
  passwordResetTokens,
  userCredentials,
  users,
} from "@ak-vision-ai/database";

import { hashPassword } from "./password.service.js";

const RESET_TTL_MINUTES = 30;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

function customerAppOrigin(): string {
  const configured = process.env.CUSTOMER_APP_URL?.trim() || "http://localhost:5173";
  return new URL(configured).origin;
}

async function sendResetEmail(email: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.PASSWORD_RESET_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Password reset email delivery is not configured.");
    }

    console.info(`AK Vision AI password reset link for ${email}: ${resetUrl}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Reset your AK Vision AI password",
      text: `Use this secure link to reset your AK Vision AI password: ${resetUrl}

This link expires in ${RESET_TTL_MINUTES} minutes and can be used only once.`,
      html: `<p>We received a request to reset your AK Vision AI password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in ${RESET_TTL_MINUTES} minutes and can be used only once.</p><p>If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Password reset email delivery failed: HTTP ${response.status}${body ? ` — ${body.slice(0, 500)}` : ""}`,
    );
  }
}

export async function requestPasswordReset(inputEmail: string): Promise<void> {
  const email = normalizeEmail(inputEmail);
  if (!email) return;

  const result = await db
    .select({ userId: users.id, email: users.email })
    .from(users)
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(and(eq(users.email, email), eq(users.role, "customer")))
    .limit(1);

  const user = result[0];
  if (!user) return;

  const rawToken = generateResetToken();
  const tokenHash = hashResetToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000);

  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now, updatedAt: now })
      .where(
        and(
          eq(passwordResetTokens.userId, user.userId),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    await tx.insert(passwordResetTokens).values({
      userId: user.userId,
      tokenHash,
      expiresAt,
    });
  });

  const resetUrl = new URL("/", customerAppOrigin());
  resetUrl.searchParams.set("token", rawToken);

  await sendResetEmail(user.email, resetUrl.toString());
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const token = rawToken.trim();

  if (!token || !newPassword) {
    throw new Error("Invalid or expired password reset token");
  }

  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }

  const tokenHash = hashResetToken(token);

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        token: passwordResetTokens,
        user: users,
      })
      .from(passwordResetTokens)
      .innerJoin(users, eq(users.id, passwordResetTokens.userId))
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .for("update")
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new Error("Invalid or expired password reset token");
    }

    if (row.user.status === "suspended" || row.user.status === "deleted") {
      throw new Error("Account is not available");
    }

    const passwordHash = await hashPassword(newPassword);
    const now = new Date();

    await tx
      .update(userCredentials)
      .set({ passwordHash, updatedAt: now })
      .where(eq(userCredentials.userId, row.user.id));

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now, updatedAt: now })
      .where(eq(passwordResetTokens.id, row.token.id));

    await tx
      .update(authSessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(authSessions.userId, row.user.id),
          isNull(authSessions.revokedAt),
        ),
      );
  });
}
