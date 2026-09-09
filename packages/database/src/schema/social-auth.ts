import { sql } from "drizzle-orm";

import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  createdAt,
  id,
  updatedAt,
} from "./common.js";

import { users } from "./users.js";

export const authIdentityProviderEnum =
  pgEnum("auth_identity_provider", [
    "google",
    "microsoft",
  ]);

export const authOAuthIntentEnum =
  pgEnum("auth_oauth_intent", [
    "login",
    "link",
  ]);

export const authIdentities =
  pgTable(
    "auth_identities",
    {
      id,

      userId: uuid("user_id")
        .notNull()
        .references(() => users.id, {
          onDelete: "cascade",
          onUpdate: "cascade",
        }),

      provider:
        authIdentityProviderEnum(
          "provider",
        ).notNull(),

      providerSubject: varchar(
        "provider_subject",
        {
          length: 512,
        },
      ).notNull(),

      providerEmail: varchar(
        "provider_email",
        {
          length: 320,
        },
      ),

      providerEmailVerified:
        boolean(
          "provider_email_verified",
        )
          .notNull()
          .default(false),

      providerDisplayName: varchar(
        "provider_display_name",
        {
          length: 120,
        },
      ),

      providerAvatarUrl: varchar(
        "provider_avatar_url",
        {
          length: 2000,
        },
      ),

      createdAt,
      updatedAt,
    },
    (table) => [
      uniqueIndex(
        "auth_identities_provider_subject_unique",
      ).on(
        table.provider,
        table.providerSubject,
      ),

      uniqueIndex(
        "auth_identities_user_provider_unique",
      ).on(
        table.userId,
        table.provider,
      ),

      index(
        "auth_identities_user_idx",
      ).on(table.userId),

      index(
        "auth_identities_provider_email_idx",
      ).on(table.providerEmail),
    ],
  );

export const authOAuthStates =
  pgTable(
    "auth_oauth_states",
    {
      id,

      provider:
        authIdentityProviderEnum(
          "provider",
        ).notNull(),

      intent:
        authOAuthIntentEnum(
          "intent",
        ).notNull(),

      userId: uuid("user_id")
        .references(() => users.id, {
          onDelete: "cascade",
          onUpdate: "cascade",
        }),

      stateHash: varchar(
        "state_hash",
        {
          length: 64,
        },
      ).notNull(),

      codeVerifier: varchar(
        "code_verifier",
        {
          length: 128,
        },
      ).notNull(),

      nonce: varchar(
        "nonce",
        {
          length: 128,
        },
      ).notNull(),

      expiresAt: timestamp(
        "expires_at",
        {
          withTimezone: true,
          mode: "date",
        },
      ).notNull(),

      consumedAt: timestamp(
        "consumed_at",
        {
          withTimezone: true,
          mode: "date",
        },
      ),

      createdAt,
      updatedAt,
    },
    (table) => [
      uniqueIndex(
        "auth_oauth_states_state_hash_unique",
      ).on(table.stateHash),

      check(
        "auth_oauth_states_link_requires_user",
        sql`(
          ${table.intent} <> 'link'
          OR ${table.userId} IS NOT NULL
        )`,
      ),

      index(
        "auth_oauth_states_expires_at_idx",
      ).on(table.expiresAt),

      index(
        "auth_oauth_states_user_idx",
      ).on(table.userId),

      index(
        "auth_oauth_states_consumed_at_idx",
      ).on(table.consumedAt),

      index(
        "auth_oauth_states_created_at_idx",
      ).on(table.createdAt),
    ],
  );

export type AuthIdentity =
  typeof authIdentities.$inferSelect;

export type NewAuthIdentity =
  typeof authIdentities.$inferInsert;

export type AuthOAuthState =
  typeof authOAuthStates.$inferSelect;

export type NewAuthOAuthState =
  typeof authOAuthStates.$inferInsert;