import {
  index,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  accountTypeEnum,
  createdAt,
  email,
  id,
  updatedAt,
  userRoleEnum,
  userStatusEnum,
} from "./common.js";

export const users = pgTable(
  "users",
  {
    id,
    email: email,
    displayName: varchar("display_name", {
      length: 120,
    }).notNull(),

    role: userRoleEnum("role")
      .notNull()
      .default("customer"),

    status: userStatusEnum("status")
      .notNull()
      .default("pending"),

    accountType: accountTypeEnum("account_type")
      .notNull()
      .default("individual"),

    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_status_idx").on(table.status),
    index("users_created_at_idx").on(table.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
