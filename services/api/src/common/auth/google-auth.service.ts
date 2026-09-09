import { sql, and, eq } from "drizzle-orm";
import {
  OAuth2Client,
  CodeChallengeMethod,
  type TokenPayload,
} from "google-auth-library";

import {
  authIdentities,
  db,
  users,
} from "@ak-vision-ai/database";

import {
  consumeOAuthState,
  createOAuthState,
} from "./oauth-state.service.js";

export class GoogleAuthError extends Error {
  readonly code:
    | "CONFIGURATION"
    | "INVALID_CALLBACK"
    | "ACCOUNT_UNAVAILABLE"
    | "ACCOUNT_EXISTS"
    | "IDENTITY_CONFLICT";

  constructor(
    message: string,
    code:
      | "CONFIGURATION"
      | "INVALID_CALLBACK"
      | "ACCOUNT_UNAVAILABLE"
      | "ACCOUNT_EXISTS"
      | "IDENTITY_CONFLICT",
  ) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

export type GoogleIdentityProfile = {
  subject: string;
  email: string;
  emailVerified: true;
  displayName: string;
  avatarUrl: string | null;
};

function requiredEnv(
  name: string,
): string {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new GoogleAuthError(
      `${name} is not configured`,
      "CONFIGURATION",
    );
  }

  return value;
}

export function getGoogleConfig() {
  return {
    clientId:
      requiredEnv("GOOGLE_CLIENT_ID"),
    clientSecret:
      requiredEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri:
      requiredEnv("GOOGLE_REDIRECT_URI"),
  };
}

export function createGoogleOAuthClient() {
  const config =
    getGoogleConfig();

  return {
    config,
    client: new OAuth2Client({
      clientId:
        config.clientId,
      clientSecret:
        config.clientSecret,
      redirectUri:
        config.redirectUri,
    }),
  };
}

function normalizeEmail(
  email: string,
): string {
  return email
    .trim()
    .toLowerCase();
}

function fallbackDisplayName(
  email: string,
): string {
  return (
    email.split("@")[0] ||
    "Google User"
  ).slice(0, 120);
}

export function validateGoogleClaims(
  payload: TokenPayload,
  expectedNonce: string,
  expectedAudience: string,
): GoogleIdentityProfile {
  const issuer =
    payload.iss;

  if (
    issuer !==
      "https://accounts.google.com" &&
    issuer !==
      "accounts.google.com"
  ) {
    throw new GoogleAuthError(
      "Google identity issuer is invalid",
      "INVALID_CALLBACK",
    );
  }

  const audiences =
    Array.isArray(payload.aud)
      ? payload.aud
      : [payload.aud];

  if (
    !audiences.includes(
      expectedAudience,
    )
  ) {
    throw new GoogleAuthError(
      "Google identity audience is invalid",
      "INVALID_CALLBACK",
    );
  }

  if (
    payload.nonce !==
    expectedNonce
  ) {
    throw new GoogleAuthError(
      "Google identity nonce mismatch",
      "INVALID_CALLBACK",
    );
  }

  const subject =
    payload.sub?.trim();

  const email =
    payload.email
      ? normalizeEmail(
          payload.email,
        )
      : "";

  if (
    !subject ||
    !email
  ) {
    throw new GoogleAuthError(
      "Google identity is missing required claims",
      "INVALID_CALLBACK",
    );
  }

  if (
    payload.email_verified !== true
  ) {
    throw new GoogleAuthError(
      "Google email address is not verified",
      "INVALID_CALLBACK",
    );
  }

  return {
    subject,
    email,
    emailVerified: true,
    displayName:
      (
        payload.name?.trim() ||
        fallbackDisplayName(email)
      ).slice(0, 120),
    avatarUrl:
      payload.picture?.trim() ||
      null,
  };
}

export async function createGoogleAuthorizationUrl() {
  const {
    client,
  } = createGoogleOAuthClient();

  const state =
    await createOAuthState({
      provider: "google",
      intent: "login",
    });

  const authorizationUrl =
    client.generateAuthUrl({
      access_type: "online",
      prompt: "select_account",
      response_type: "code",
      scope: [
        "openid",
        "email",
        "profile",
      ],
      state: state.state,
      nonce: state.nonce,
      code_challenge:
        state.codeChallenge,
      code_challenge_method:
        CodeChallengeMethod.S256,
    });

  return {
    authorizationUrl,
    stateId:
      state.stateId,
  };
}

export async function consumeGoogleCallbackState(
  state: string,
) {
  return consumeOAuthState({
    state,
    provider: "google",
    intent: "login",
  });
}

export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
) {
  const {
    client,
  } = createGoogleOAuthClient();

  const config =
    getGoogleConfig();

  try {
    const response =
      await client.getToken({
        code,
        codeVerifier,
        redirect_uri:
          config.redirectUri,
      });

    const idToken =
      response.tokens.id_token;

    if (!idToken) {
      throw new GoogleAuthError(
        "Google did not return an ID token",
        "INVALID_CALLBACK",
      );
    }

    return idToken;
  } catch (error) {
    if (
      error instanceof
      GoogleAuthError
    ) {
      throw error;
    }

    throw new GoogleAuthError(
      "Google authorization could not be completed",
      "INVALID_CALLBACK",
    );
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<GoogleIdentityProfile> {
  const {
    client,
    config,
  } = createGoogleOAuthClient();

  try {
    const ticket =
      await client.verifyIdToken({
        idToken,
        audience:
          config.clientId,
      });

    const payload =
      ticket.getPayload();

    if (!payload) {
      throw new GoogleAuthError(
        "Google identity payload is missing",
        "INVALID_CALLBACK",
      );
    }

    return validateGoogleClaims(
      payload,
      expectedNonce,
      config.clientId,
    );
  } catch (error) {
    if (
      error instanceof
      GoogleAuthError
    ) {
      throw error;
    }

    throw new GoogleAuthError(
      "Google identity verification failed",
      "INVALID_CALLBACK",
    );
  }
}

export async function resolveGoogleIdentity(
  profile: GoogleIdentityProfile,
) {
  return db.transaction(
    async (tx) => {
      await tx.execute(
        sql`
          select pg_advisory_xact_lock(
            hashtextextended(
              ${`google:subject:${profile.subject}`},
              0
            )
          )
        `,
      );

      await tx.execute(
        sql`
          select pg_advisory_xact_lock(
            hashtextextended(
              ${`google:email:${profile.email}`},
              0
            )
          )
        `,
      );

      const existing =
        await tx
          .select({
            identity:
              authIdentities,
            user: users,
          })
          .from(authIdentities)
          .innerJoin(
            users,
            eq(
              users.id,
              authIdentities.userId,
            ),
          )
          .where(
            and(
              eq(
                authIdentities.provider,
                "google",
              ),
              eq(
                authIdentities.providerSubject,
                profile.subject,
              ),
            ),
          )
          .limit(1);

      const linked =
        existing[0];

      if (linked) {
        if (
          linked.user.status ===
            "suspended" ||
          linked.user.status ===
            "deleted"
        ) {
          throw new GoogleAuthError(
            "Account is not available",
            "ACCOUNT_UNAVAILABLE",
          );
        }

        await tx
          .update(authIdentities)
          .set({
            providerEmail:
              profile.email,
            providerEmailVerified:
              true,
            providerDisplayName:
              profile.displayName,
            providerAvatarUrl:
              profile.avatarUrl,
            updatedAt:
              new Date(),
          })
          .where(
            eq(
              authIdentities.id,
              linked.identity.id,
            ),
          );

        return linked.user;
      }

      /*
       * SECURITY DECISION:
       * Do not silently merge Google into an
       * existing password account.
       *
       * Existing users must explicitly link
       * Google after authenticated login.
       */
      const existingEmail =
        await tx
          .select()
          .from(users)
          .where(
            eq(
              users.email,
              profile.email,
            ),
          )
          .limit(1);

      const emailUser =
        existingEmail[0];

      if (emailUser) {
        if (
          emailUser.status ===
            "suspended" ||
          emailUser.status ===
            "deleted"
        ) {
          throw new GoogleAuthError(
            "Account is not available",
            "ACCOUNT_UNAVAILABLE",
          );
        }

        throw new GoogleAuthError(
          "An account with this email already exists. Sign in and link Google from account settings.",
          "ACCOUNT_EXISTS",
        );
      }

      const inserted =
        await tx
          .insert(users)
          .values({
            email:
              profile.email,
            displayName:
              profile.displayName,
            role:
              "customer",
            status:
              "active",
            accountType:
              "individual",
          })
          .returning();

      const user =
        inserted[0];

      if (!user) {
        throw new GoogleAuthError(
          "Failed to create Google account",
          "INVALID_CALLBACK",
        );
      }

      await tx
        .insert(authIdentities)
        .values({
          userId:
            user.id,
          provider:
            "google",
          providerSubject:
            profile.subject,
          providerEmail:
            profile.email,
          providerEmailVerified:
            true,
          providerDisplayName:
            profile.displayName,
          providerAvatarUrl:
            profile.avatarUrl,
        });

      return user;
    },
  );
}