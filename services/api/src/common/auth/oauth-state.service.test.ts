import {
  before,
  after,
  test,
} from "node:test";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

import {
  and,
  eq,
} from "drizzle-orm";

import {
  authOAuthStates,
  db,
} from "@ak-vision-ai/database";

import {
  createOAuthState,
  consumeOAuthState,
  createPkceChallenge,
  OAuthStateError,
} from "./oauth-state.service.js";

const createdIds: string[] = [];

before(async () => {
  await db.execute(
    `select 1`,
  );
});

after(async () => {
  for (
    const id of createdIds
  ) {
    await db
      .delete(authOAuthStates)
      .where(
        eq(
          authOAuthStates.id,
          id,
        ),
      );
  }
});

test(
  "creates high-entropy state with PKCE and nonce",
  async () => {
    const result =
      await createOAuthState({
        provider: "google",
        intent: "login",
      });

    createdIds.push(
      result.stateId,
    );

    assert.ok(
      result.state.length >= 43,
    );

    assert.ok(
      result.codeVerifier.length >= 43,
    );

    assert.ok(
      result.codeChallenge.length >= 43,
    );

    assert.ok(
      result.nonce.length >= 43,
    );

    assert.notEqual(
      result.state,
      result.codeVerifier,
    );

    assert.equal(
      result.codeChallenge,
      createPkceChallenge(
        result.codeVerifier,
      ),
    );

    const stored =
      await db
        .select()
        .from(authOAuthStates)
        .where(
          eq(
            authOAuthStates.id,
            result.stateId,
          ),
        )
        .limit(1);

    assert.ok(stored[0]);

    assert.notEqual(
      stored[0].stateHash,
      result.state,
    );
  },
);

test(
  "state is consumed exactly once",
  async () => {
    const created =
      await createOAuthState({
        provider: "microsoft",
        intent: "login",
      });

    createdIds.push(
      created.stateId,
    );

    const first =
      await consumeOAuthState({
        state: created.state,
        provider: "microsoft",
        intent: "login",
      });

    assert.equal(
      first.stateId,
      created.stateId,
    );

    await assert.rejects(
      consumeOAuthState({
        state: created.state,
        provider: "microsoft",
        intent: "login",
      }),
      (error: unknown) =>
        error instanceof OAuthStateError &&
        error.code === "INVALID_STATE",
    );
  },
);

test(
  "provider mismatch is rejected",
  async () => {
    const created =
      await createOAuthState({
        provider: "google",
        intent: "login",
      });

    createdIds.push(
      created.stateId,
    );

    await assert.rejects(
      consumeOAuthState({
        state: created.state,
        provider: "microsoft",
        intent: "login",
      }),
      (error: unknown) =>
        error instanceof OAuthStateError &&
        error.code === "INVALID_STATE",
    );
  },
);

test(
  "intent mismatch is rejected",
  async () => {
    const created =
      await createOAuthState({
        provider: "google",
        intent: "login",
      });

    createdIds.push(
      created.stateId,
    );

    await assert.rejects(
      consumeOAuthState({
        state: created.state,
        provider: "google",
        intent: "link",
      }),
      (error: unknown) =>
        error instanceof OAuthStateError &&
        error.code === "INVALID_STATE",
    );
  },
);

test(
  "link intent requires a user",
  async () => {
    await assert.rejects(
      createOAuthState({
        provider: "google",
        intent: "link",
      }),
      (error: unknown) =>
        error instanceof OAuthStateError &&
        error.code === "INVALID_INPUT",
    );
  },
);

test(
  "expired state cannot be consumed",
  async () => {
    const state = Buffer
      .from(
        randomBytes(32),
      )
      .toString("base64url");

    function hash(
      value: string,
    ): string {
      return createHash("sha256")
        .update(value, "utf8")
        .digest("hex");
    }

    const inserted =
      await db
        .insert(authOAuthStates)
        .values({
          provider: "google",
          intent: "login",
          userId: null,
          stateHash: hash(state),
          codeVerifier:
            randomBytes(32)
              .toString("base64url"),
          nonce:
            randomBytes(32)
              .toString("base64url"),
          expiresAt:
            new Date(
              Date.now() - 1000,
            ),
        })
        .returning({
          id: authOAuthStates.id,
        });

    const row =
      inserted[0];

    assert.ok(row);

    createdIds.push(row.id);

    await assert.rejects(
      consumeOAuthState({
        state,
        provider: "google",
        intent: "login",
      }),
      (error: unknown) =>
        error instanceof OAuthStateError &&
        error.code === "INVALID_STATE",
    );
  },
);

test(
  "concurrent consumption allows exactly one winner",
  async () => {
    const created =
      await createOAuthState({
        provider: "google",
        intent: "login",
      });

    createdIds.push(
      created.stateId,
    );

    const results =
      await Promise.allSettled([
        consumeOAuthState({
          state: created.state,
          provider: "google",
          intent: "login",
        }),
        consumeOAuthState({
          state: created.state,
          provider: "google",
          intent: "login",
        }),
      ]);

    const successCount =
      results.filter(
        (result) =>
          result.status ===
          "fulfilled",
      ).length;

    const failureCount =
      results.filter(
        (result) =>
          result.status ===
          "rejected",
      ).length;

    assert.equal(
      successCount,
      1,
    );

    assert.equal(
      failureCount,
      1,
    );
  },
);

