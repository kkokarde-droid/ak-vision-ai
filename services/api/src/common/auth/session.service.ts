import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import {
  authSessions,
  db,
} from "@ak-vision-ai/database";

const DEFAULT_SESSION_TTL_DAYS = 30;

function hashSessionToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function getSessionExpiry(
  ttlDays = DEFAULT_SESSION_TTL_DAYS,
): Date {
  const expiresAt = new Date();

  expiresAt.setDate(
    expiresAt.getDate() + ttlDays,
  );

  return expiresAt;
}

export type CreateSessionResult = {
  token: string;
  sessionId: string;
  expiresAt: Date;
};

export async function createSession(
  userId: string,
  ttlDays = DEFAULT_SESSION_TTL_DAYS,
): Promise<CreateSessionResult> {
  if (!userId) {
    throw new Error("userId is required");
  }

  if (
    !Number.isInteger(ttlDays) ||
    ttlDays < 1 ||
    ttlDays > 365
  ) {
    throw new Error(
      "ttlDays must be an integer between 1 and 365",
    );
  }

  const token = generateSessionToken();

  const tokenHash = hashSessionToken(token);

  const expiresAt = getSessionExpiry(ttlDays);

  const result = await db
    .insert(authSessions)
    .values({
      userId,
      tokenHash,
      expiresAt,
    })
    .returning({
      id: authSessions.id,
      expiresAt: authSessions.expiresAt,
    });

  const session = result[0];

  if (!session) {
    throw new Error(
      "Failed to create authentication session",
    );
  }

  return {
    token,
    sessionId: session.id,
    expiresAt: session.expiresAt,
  };
}

export async function getSessionByToken(
  token: string,
) {
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);

  const result = await db
    .select()
    .from(authSessions)
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

export async function revokeSession(
  sessionId: string,
): Promise<boolean> {
  if (!sessionId) {
    return false;
  }

  const result = await db
    .update(authSessions)
    .set({
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(authSessions.id, sessionId),
        isNull(authSessions.revokedAt),
      ),
    )
    .returning({
      id: authSessions.id,
    });

  return Boolean(result[0]);
}

export async function revokeSessionByToken(
  token: string,
): Promise<boolean> {
  if (!token) {
    return false;
  }

  const session = await getSessionByToken(token);

  if (!session) {
    return false;
  }

  return revokeSession(session.id);
}

export async function revokeAllUserSessions(
  userId: string,
): Promise<number> {
  if (!userId) {
    return 0;
  }

  const result = await db
    .update(authSessions)
    .set({
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
      ),
    )
    .returning({
      id: authSessions.id,
    });

  return result.length;
}