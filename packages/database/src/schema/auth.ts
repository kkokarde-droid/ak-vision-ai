import {
  index,
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

export const userCredentials = pgTable(
  "user_credentials",
  {
    id,

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    passwordHash: varchar("password_hash", {
      length: 255,
    }).notNull(),

    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("user_credentials_user_unique")
      .on(table.userId),

    index("user_credentials_created_at_idx")
      .on(table.createdAt),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id,

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    tokenHash: varchar("token_hash", {
      length: 255,
    }).notNull(),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date",
    }),

    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique")
      .on(table.tokenHash),

    index("auth_sessions_user_idx")
      .on(table.userId),

    index("auth_sessions_expires_at_idx")
      .on(table.expiresAt),

    index("auth_sessions_revoked_at_idx")
      .on(table.revokedAt),

    index("auth_sessions_created_at_idx")
      .on(table.createdAt),
  ],
);

export type UserCredential =
  typeof userCredentials.$inferSelect;

export type NewUserCredential =
  typeof userCredentials.$inferInsert;

export type AuthSession =
  typeof authSessions.$inferSelect;

export type NewAuthSession =
  typeof authSessions.$inferInsert;