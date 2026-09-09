import type {
  FastifyInstance,
  FastifyReply,
} from "fastify";

import { Type } from "@sinclair/typebox";

import {
  createSession,
} from "../../common/auth/session.service.js";

import {
  createGoogleAuthorizationUrl,
  consumeGoogleCallbackState,
  exchangeGoogleCode,
  verifyGoogleIdToken,
  resolveGoogleIdentity,
  GoogleAuthError,
} from "../../common/auth/google-auth.service.js";

const SESSION_COOKIE =
  "ak_vision_session";

const isProduction =
  process.env.NODE_ENV ===
  "production";

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(
    SESSION_COOKIE,
    token,
    {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    },
  );
}

function customerAppOrigin(): string {
  const configured =
    process.env.CUSTOMER_APP_URL?.trim() ||
    "http://localhost:5173";

  return new URL(
    configured,
  ).origin;
}

function redirectOAuthError(
  reply: FastifyReply,
  code: string,
) {
  const target =
    new URL(
      customerAppOrigin(),
    );

  target.searchParams.set(
    "oauth_error",
    code,
  );

  return reply.redirect(
    target.toString(),
    302,
  );
}

export async function googleAuthRoutes(
  app: FastifyInstance,
) {
  /*
   * GET /api/v1/auth/google/start
   *
   * Creates a fresh login-intent state containing:
   * - cryptographic state
   * - PKCE verifier/challenge
   * - nonce
   *
   * No authentication is required here.
   */
  app.get(
    "/google/start",
    async (_request, reply) => {
      try {
        const result =
          await createGoogleAuthorizationUrl();

        return reply.redirect(
          result.authorizationUrl,
          302,
        );
      } catch (error) {
        if (
          error instanceof
          GoogleAuthError
        ) {
          return reply
            .code(
              error.code ===
                "CONFIGURATION"
                ? 503
                : 400,
            )
            .send({
              status: "error",
              code:
                error.code,
              message:
                error.message,
            });
        }

        app.log.error(error);

        return reply
          .code(503)
          .send({
            status: "error",
            code:
              "GOOGLE_AUTH_UNAVAILABLE",
            message:
              "Google sign-in is temporarily unavailable",
          });
      }
    },
  );

  /*
   * GET /api/v1/auth/google/callback
   */
  app.get<{
    Querystring: {
      state: string;
      code?: string;
      scope?: string;
      authuser?: string;
      prompt?: string;
      hd?: string;
      error?: string;
      error_description?: string;
      error_uri?: string;
    };
  }>(
    "/google/callback",
    {
      schema: {
        querystring:
          Type.Object(
            {
              state:
                Type.String({
                  minLength: 32,
                  maxLength: 512,
                }),

              code:
                Type.Optional(
                  Type.String({
                    minLength: 1,
                    maxLength: 4096,
                  }),
                ),

              scope:
                Type.Optional(
                  Type.String({
                    maxLength: 4000,
                  }),
                ),

              authuser:
                Type.Optional(
                  Type.String({
                    maxLength: 32,
                  }),
                ),

              prompt:
                Type.Optional(
                  Type.String({
                    maxLength: 100,
                  }),
                ),

              hd:
                Type.Optional(
                  Type.String({
                    maxLength: 320,
                  }),
                ),

              error:
                Type.Optional(
                  Type.String({
                    maxLength: 100,
                  }),
                ),

              error_description:
                Type.Optional(
                  Type.String({
                    maxLength: 1000,
                  }),
                ),

              error_uri:
                Type.Optional(
                  Type.String({
                    maxLength: 2000,
                  }),
                ),
            },
            {
              /*
               * Google may return additional query parameters
               * in the OAuth callback. We validate and consume
               * only the fields used by our flow:
               * state, code/error, and known callback metadata.
               * Unknown provider fields are intentionally ignored.
               */
              additionalProperties:
                true,
            },
          ),
      },
    },
    async (
      request,
      reply,
    ) => {
      try {
        /*
         * Consume state exactly once BEFORE processing
         * the authorization result. This prevents replay
         * even when the Google user presses Back/retries.
         */
        const state =
          await consumeGoogleCallbackState(
            request.query.state,
          );

        /*
         * User explicitly denied the Google authorization.
         */
        if (
          request.query.error
        ) {
          return redirectOAuthError(
            reply,
            "google_cancelled",
          );
        }

        if (
          !request.query.code
        ) {
          return redirectOAuthError(
            reply,
            "google_failed",
          );
        }

        /*
         * Exchange authorization code on the server.
         * The client secret never reaches the browser.
         */
        const idToken =
          await exchangeGoogleCode(
            request.query.code,
            state.codeVerifier,
          );

        /*
         * Verify:
         * - Google signature
         * - audience
         * - issuer
         * - nonce
         * - required subject/email claims
         * - verified email
         */
        const profile =
          await verifyGoogleIdToken(
            idToken,
            state.nonce,
          );

        /*
         * Resolve the Google identity against AK Vision AI.
         * Existing password accounts are NOT silently merged.
         */
        const user =
          await resolveGoogleIdentity(
            profile,
          );

        /*
         * Normal AK Vision AI session cookie.
         */
        const session =
          await createSession(
            user.id,
          );

        setSessionCookie(
          reply,
          session.token,
          session.expiresAt,
        );

        return reply.redirect(
          customerAppOrigin(),
          302,
        );
      } catch (error) {
        if (
          error instanceof
          GoogleAuthError
        ) {
          switch (
            error.code
          ) {
            case "ACCOUNT_EXISTS":
              return redirectOAuthError(
                reply,
                "google_account_exists",
              );

            case "ACCOUNT_UNAVAILABLE":
              return redirectOAuthError(
                reply,
                "google_account_unavailable",
              );

            case "IDENTITY_CONFLICT":
            case "INVALID_CALLBACK":
              return redirectOAuthError(
                reply,
                "google_failed",
              );

            case "CONFIGURATION":
              app.log.error(error);

              return reply
                .code(503)
                .send({
                  status: "error",
                  code:
                    "GOOGLE_AUTH_UNAVAILABLE",
                  message:
                    "Google sign-in is temporarily unavailable",
                });
          }
        }

        app.log.error(error);

        return redirectOAuthError(
          reply,
          "google_failed",
        );
      }
    },
  );
}