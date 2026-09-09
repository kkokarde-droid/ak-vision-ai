import {
  index,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  createdAt,
  id,
  organizationRoleEnum,
  updatedAt,
} from "./common.js";

import { users } from "./users.js";

export const organizations = pgTable(
  "organizations",
  {
    id,

    name: varchar("name", {
      length: 200,
    }).notNull(),

    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    createdAt,
    updatedAt,
  },
  (table) => [
    index("organizations_owner_user_idx")
      .on(table.ownerUserId),

    index("organizations_created_at_idx")
      .on(table.createdAt),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id,

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    role: organizationRoleEnum("role")
      .notNull()
      .default("member"),

    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("organization_membership_unique")
      .on(table.organizationId, table.userId),

    index("organization_memberships_user_idx")
      .on(table.userId),

    index("organization_memberships_org_idx")
      .on(table.organizationId),
  ],
);

export type Organization =
  typeof organizations.$inferSelect;

export type NewOrganization =
  typeof organizations.$inferInsert;

export type OrganizationMembership =
  typeof organizationMemberships.$inferSelect;

export type NewOrganizationMembership =
  typeof organizationMemberships.$inferInsert;
