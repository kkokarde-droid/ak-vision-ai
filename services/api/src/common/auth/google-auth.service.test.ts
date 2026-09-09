import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  TokenPayload,
} from "google-auth-library";

import {
  GoogleAuthError,
  validateGoogleClaims,
} from "./google-auth.service.js";

type MutablePayload =
  Record<string, unknown>;

function validPayload(
  overrides: MutablePayload = {},
): TokenPayload {
  const now =
    Math.floor(
      Date.now() / 1000,
    );

  return {
    iss:
      "https://accounts.google.com",

    aud:
      "test-google-client",

    sub:
      "google-sub-123",

    email:
      "user@example.com",

    email_verified:
      true,

    nonce:
      "expected-nonce",

    name:
      "Test User",

    picture:
      "https://example.com/avatar.png",

    iat:
      now - 60,

    exp:
      now + 3600,

    ...overrides,
  } as TokenPayload;
}

function malformedPayload(
  payload: MutablePayload,
): TokenPayload {
  return payload as unknown as TokenPayload;
}

test(
  "valid Google claims are accepted",
  () => {
    const result =
      validateGoogleClaims(
        validPayload(),
        "expected-nonce",
        "test-google-client",
      );

    assert.equal(
      result.subject,
      "google-sub-123",
    );

    assert.equal(
      result.email,
      "user@example.com",
    );

    assert.equal(
      result.emailVerified,
      true,
    );

    assert.equal(
      result.displayName,
      "Test User",
    );
  },
);

test(
  "invalid issuer is rejected",
  () => {
    const payload =
      validPayload({
        iss:
          "https://evil.example.com",
      });

    assert.throws(
      () =>
        validateGoogleClaims(
          payload,
          "expected-nonce",
          "test-google-client",
        ),
      (
        error: unknown,
      ) =>
        error instanceof
          GoogleAuthError &&
        error.code ===
          "INVALID_CALLBACK",
    );
  },
);

test(
  "invalid audience is rejected",
  () => {
    const payload =
      validPayload({
        aud:
          "attacker-client",
      });

    assert.throws(
      () =>
        validateGoogleClaims(
          payload,
          "expected-nonce",
          "test-google-client",
        ),
      (
        error: unknown,
      ) =>
        error instanceof
          GoogleAuthError &&
        error.code ===
          "INVALID_CALLBACK",
    );
  },
);

test(
  "wrong nonce is rejected",
  () => {
    assert.throws(
      () =>
        validateGoogleClaims(
          validPayload(),
          "wrong-nonce",
          "test-google-client",
        ),
      (
        error: unknown,
      ) =>
        error instanceof
          GoogleAuthError &&
        error.code ===
          "INVALID_CALLBACK",
    );
  },
);

test(
  "unverified Google email is rejected",
  () => {
    const payload =
      validPayload({
        email_verified:
          false,
      });

    assert.throws(
      () =>
        validateGoogleClaims(
          payload,
          "expected-nonce",
          "test-google-client",
        ),
      (
        error: unknown,
      ) =>
        error instanceof
          GoogleAuthError &&
        error.code ===
          "INVALID_CALLBACK",
    );
  },
);

test(
  "missing Google subject is rejected",
  () => {
    const payload =
      validPayload() as unknown as MutablePayload;

    delete payload.sub;

    assert.throws(
      () =>
        validateGoogleClaims(
          malformedPayload(
            payload,
          ),
          "expected-nonce",
          "test-google-client",
        ),
      (
        error: unknown,
      ) =>
        error instanceof
          GoogleAuthError &&
        error.code ===
          "INVALID_CALLBACK",
    );
  },
);

test(
  "missing Google email is rejected",
  () => {
    const payload =
      validPayload() as unknown as MutablePayload;

    delete payload.email;

    assert.throws(
      () =>
        validateGoogleClaims(
          malformedPayload(
            payload,
          ),
          "expected-nonce",
          "test-google-client",
        ),
      (
        error: unknown,
      ) =>
        error instanceof
          GoogleAuthError &&
        error.code ===
          "INVALID_CALLBACK",
    );
  },
);

test(
  "Google audience array is accepted when it contains the configured client",
  () => {
    const payload =
      validPayload({
        aud: [
          "another-client",
          "test-google-client",
        ],
      });

    /*
     * This is a runtime-shape test. The installed
     * google-auth-library declaration models aud as
     * string, so only the synthetic fixture crosses
     * the type boundary.
     */
    const result =
      validateGoogleClaims(
        malformedPayload(
          payload as unknown as MutablePayload,
        ),
        "expected-nonce",
        "test-google-client",
      );

    assert.equal(
      result.subject,
      "google-sub-123",
    );
  },
);