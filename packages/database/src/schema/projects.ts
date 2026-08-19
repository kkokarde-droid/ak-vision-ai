import {
  index,
  pgTable,
  uuid,
  varchar,
  text,
} from "drizzle-orm/pg-core";

import {
  createdAt,
  id,
  projectStatusEnum,
  projectTypeEnum,
  updatedAt,
} from "./common.js";

import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const projects = pgTable(
  "projects",
  {
    id,

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    name: varchar("name", {
      length: 200,
    }).notNull(),

    description: text("description"),

    type: projectTypeEnum("type")
      .notNull()
      .default("general"),

    status: projectStatusEnum("status")
      .notNull()
      .default("active"),

    createdAt,
    updatedAt,
  },
  (table) => [
    index("projects_organization_idx").on(table.organizationId),
    index("projects_owner_idx").on(table.ownerUserId),
    index("projects_status_idx").on(table.status),
    index("projects_created_at_idx").on(table.createdAt),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
