import { sql } from "drizzle-orm";

import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  artifactStatusEnum,
  artifactTypeEnum,
  createdAt,
  id,
  updatedAt,
} from "./common.js";

import { users } from "./users.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { conversations } from "./conversations.js";

export const artifacts = pgTable(
  "artifacts",
  {
    id,

    projectId: uuid("project_id")
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    conversationId: uuid("conversation_id")
      .references(() => conversations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    organizationId: uuid("organization_id")
      .references(() => organizations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    name: varchar("name", {
      length: 500,
    }).notNull(),

    storageKey: varchar("storage_key", {
      length: 1000,
    }),

    type: artifactTypeEnum("type")
      .notNull(),

    status: artifactStatusEnum("status")
      .notNull()
      .default("processing"),

    version: integer("version")
      .notNull()
      .default(1),

    mimeType: varchar("mime_type", {
      length: 255,
    }),

    sizeBytes: integer("size_bytes"),

    storageUrl: varchar("storage_url", {
      length: 4000,
    }),

    previewUrl: varchar("preview_url", {
      length: 4000,
    }),

    metadata: jsonb("metadata"),

    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "artifacts_version_valid",
      sql`${table.version} > 0`,
    ),

    check(
      "artifacts_size_nonnegative",
      sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`,
    ),

    uniqueIndex("artifacts_storage_key_unique").on(table.storageKey),

    index("artifacts_owner_user_idx")
      .on(table.ownerUserId),

    index("artifacts_organization_idx")
      .on(table.organizationId),

    index("artifacts_project_idx")
      .on(table.projectId),

    index("artifacts_conversation_idx")
      .on(table.conversationId),

    index("artifacts_status_idx")
      .on(table.status),

    index("artifacts_type_idx")
      .on(table.type),

    index("artifacts_created_at_idx")
      .on(table.createdAt),
  ],
);

export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id,

    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    version: integer("version")
      .notNull(),

    storageUrl: varchar("storage_url", {
      length: 4000,
    }),

    previewUrl: varchar("preview_url", {
      length: 4000,
    }),

    changeSummary: varchar("change_summary", {
      length: 2000,
    }),

    createdAt,
  },
  (table) => [
    check(
      "artifact_versions_version_valid",
      sql`${table.version} > 0`,
    ),

    uniqueIndex(
      "artifact_versions_artifact_version_unique",
    ).on(
      table.artifactId,
      table.version,
    ),

    index("artifact_versions_artifact_idx")
      .on(table.artifactId),

    index("artifact_versions_created_at_idx")
      .on(table.createdAt),
  ],
);

export type ArtifactRecord =
  typeof artifacts.$inferSelect;

export type NewArtifact =
  typeof artifacts.$inferInsert;

export type ArtifactVersionRecord =
  typeof artifactVersions.$inferSelect;

export type NewArtifactVersion =
  typeof artifactVersions.$inferInsert;


