import {
  createHash,
  randomBytes,
} from "node:crypto";

import {
  and,
  eq,
  gt,
  isNull,
} from "drizzle-orm";

import {
  authOAuthStates,
  db,
} from "@ak-vision-ai/database";

export type OAuthProvider =
  | "google"
  | "microsoft";

export type OAuthIntent =
  | "login"
  | "link";

export type CreateOAuthStateInput = {
  provider: OAuthProvider;
  intent: OAuthIntent;
  userId?: string;
  ttlSeconds?: number;
};

export type CreatedOAuthState = {
  stateId: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
  expiresAt: Date;
};

export type ConsumedOAuthState = {
  stateId: string;
  provider: OAuthProvider;
  intent: OAuthIntent;
  userId: string | null;
  codeVerifier: string;
  nonce: string;
  expiresAt: Date;
  consumedAt: Date;
};

export class OAuthStateError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "INVALID_STATE";

  constructor(
    message: string,
    code:
      | "INVALID_INPUT"
      | "INVALID_STATE",
  ) {
    super(message);
    this.name = "OAuthStateError";
    this.code = code;
  }
}

const DEFAULT_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 600;

function randomToken(
  byteLength: number,
): string {
  return randomBytes(byteLength)
    .toString("base64url");
}

function sha256(
  value: string,
): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function createPkceChallenge(
  codeVerifier: string,
): string {
  if (
    typeof codeVerifier !== "string" ||
    codeVerifier.length < 43 ||
    codeVerifier.length > 128
  ) {
    throw new OAuthStateError(
      "Invalid PKCE code verifier",
      "INVALID_INPUT",
    );
  }

  return createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
}

function assertProvider(
  provider: string,
): asserts provider is OAuthProvider {
  if (
    provider !== "google" &&
    provider !== "microsoft"
  ) {
    throw new OAuthStateError(
      "Unsupported OAuth provider",
      "INVALID_INPUT",
    );
  }
}

function assertIntent(
  intent: string,
): asserts intent is OAuthIntent {
  if (
    intent !== "login" &&
    intent !== "link"
  ) {
    throw new OAuthStateError(
      "Unsupported OAuth intent",
      "INVALID_INPUT",
    );
  }
}

export async function createOAuthState(
  input: CreateOAuthStateInput,
): Promise<CreatedOAuthState> {
  assertProvider(input.provider);
  assertIntent(input.intent);

  const ttlSeconds =
    input.ttlSeconds ??
    DEFAULT_TTL_SECONDS;

  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < MIN_TTL_SECONDS ||
    ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw new OAuthStateError(
      "ttlSeconds must be between 60 and 600",
      "INVALID_INPUT",
    );
  }

  if (
    input.intent === "link" &&
    !input.userId
  ) {
    throw new OAuthStateError(
      "userId is required for link intent",
      "INVALID_INPUT",
    );
  }

  if (
    input.intent === "login" &&
    input.userId !== undefined
  ) {
    throw new OAuthStateError(
      "userId must not be supplied for login intent",
      "INVALID_INPUT",
    );
  }

  const state =
    randomToken(32);

  const codeVerifier =
    randomToken(32);

  const codeChallenge =
    createPkceChallenge(
      codeVerifier,
    );

  const nonce =
    randomToken(32);

  const now = new Date();

  const expiresAt =
    new Date(
      now.getTime() +
        ttlSeconds * 1000,
    );

  const stateHash =
    sha256(state);

  const inserted =
    await db
      .insert(authOAuthStates)
      .values({
        provider: input.provider,
        intent: input.intent,
        userId:
          input.userId ?? null,
        stateHash,
        codeVerifier,
        nonce,
        expiresAt,
      })
      .returning({
        id: authOAuthStates.id,
        expiresAt:
          authOAuthStates.expiresAt,
      });

  const created =
    inserted[0];

  if (!created) {
    throw new OAuthStateError(
      "Failed to create OAuth state",
      "INVALID_STATE",
    );
  }

  return {
    stateId: created.id,
    state,
    codeVerifier,
    codeChallenge,
    nonce,
    expiresAt:
      created.expiresAt,
  };
}

export async function consumeOAuthState(
  input: {
    state: string;
    provider: OAuthProvider;
    intent: OAuthIntent;
  },
): Promise<ConsumedOAuthState> {
  assertProvider(input.provider);
  assertIntent(input.intent);

  const state =
    input.state.trim();

  if (
    state.length < 32 ||
    state.length > 512
  ) {
    throw new OAuthStateError(
      "Invalid OAuth state",
      "INVALID_STATE",
    );
  }

  const stateHash =
    sha256(state);

  const now = new Date();

  /*
   * Atomic one-time consumption:
   *
   * - exact state hash
   * - exact provider
   * - exact intent
   * - not previously consumed
   * - not expired
   *
   * Concurrent callbacks cannot both consume the same row.
   */
  const updated =
    await db
      .update(authOAuthStates)
      .set({
        consumedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            authOAuthStates.stateHash,
            stateHash,
          ),
          eq(
            authOAuthStates.provider,
            input.provider,
          ),
          eq(
            authOAuthStates.intent,
            input.intent,
          ),
          isNull(
            authOAuthStates.consumedAt,
          ),
          gt(
            authOAuthStates.expiresAt,
            now,
          ),
        ),
      )
      .returning({
        id: authOAuthStates.id,
        provider:
          authOAuthStates.provider,
        intent:
          authOAuthStates.intent,
        userId:
          authOAuthStates.userId,
        codeVerifier:
          authOAuthStates.codeVerifier,
        nonce:
          authOAuthStates.nonce,
        expiresAt:
          authOAuthStates.expiresAt,
        consumedAt:
          authOAuthStates.consumedAt,
      });

  const consumed =
    updated[0];

  if (!consumed) {
    /*
     * Keep failure intentionally generic.
     * We do not reveal whether the state was
     * expired, replayed, or mismatched.
     */
    throw new OAuthStateError(
      "Invalid or expired OAuth state",
      "INVALID_STATE",
    );
  }

  if (
    !consumed.consumedAt
  ) {
    throw new OAuthStateError(
      "OAuth state consumption failed",
      "INVALID_STATE",
    );
  }

  return {
    stateId: consumed.id,
    provider: consumed.provider,
    intent: consumed.intent,
    userId: consumed.userId,
    codeVerifier: consumed.codeVerifier,
    nonce: consumed.nonce,
    expiresAt: consumed.expiresAt,
    consumedAt: consumed.consumedAt,
  };
}