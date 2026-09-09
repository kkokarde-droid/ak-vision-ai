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
  createdAt,
  generationPriorityEnum,
  generationStatusEnum,
  generationTypeEnum,
  id,
  updatedAt,
} from "./common.js";

import { users } from "./users.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { conversations } from "./conversations.js";
import { creditReservations } from "./credits.js";
import { artifacts } from "./artifacts.js";

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id,

    requestId: uuid("request_id")
      .notNull(),

    userId: uuid("user_id")
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

    creditReservationId: uuid(
      "credit_reservation_id",
    )
      .notNull()
      .references(() => creditReservations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    type: generationTypeEnum("type")
      .notNull(),

    status: generationStatusEnum("status")
      .notNull()
      .default("queued"),

    priority: generationPriorityEnum(
      "priority",
    )
      .notNull()
      .default("normal"),

    providerId: varchar("provider_id", {
      length: 100,
    }),

    providerModelId: varchar(
      "provider_model_id",
      {
        length: 150,
      },
    ),

providerRequestId: varchar(
  "provider_request_id",
  {
    length: 255,
  },
),

    progress: integer("progress")
      .notNull()
      .default(0),

    prompt: varchar("prompt", {
      length: 10000,
    }),

    input: jsonb("input"),

    /**
     * Immutable server-calculated pricing snapshot.
     *
     * This must never contain client-supplied pricing values.
     */
    pricingSnapshot: jsonb(
      "pricing_snapshot",
    ),

    output: jsonb("output"),

    errorCode: varchar("error_code", {
      length: 100,
    }),

    errorMessage: varchar(
      "error_message",
      {
        length: 2000,
      },
    ),

    attemptCount: integer(
      "attempt_count",
    )
      .notNull()
      .default(0),

    maxAttempts: integer(
      "max_attempts",
    )
      .notNull()
      .default(3),

    nextAttemptAt: timestamp(
      "next_attempt_at",
      {
        withTimezone: true,
        mode: "date",
      },
    ),

    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }),

    completedAt: timestamp(
      "completed_at",
      {
        withTimezone: true,
        mode: "date",
      },
    ),

    lockedAt: timestamp("locked_at", {
      withTimezone: true,
      mode: "date",
    }),

    lockedBy: varchar("locked_by", {
      length: 255,
    }),

    leaseExpiresAt: timestamp(
      "lease_expires_at",
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
      "generation_jobs_request_unique",
    ).on(table.requestId),

    uniqueIndex(
      "generation_jobs_reservation_unique",
    ).on(table.creditReservationId),

uniqueIndex(
  "generation_jobs_provider_request_unique",
).on(
  table.providerId,
  table.providerRequestId,
),

    check(
      "generation_jobs_progress_valid",
      sql`${table.progress} >= 0 AND ${table.progress} <= 100`,
    ),

    check(
      "generation_jobs_attempt_count_valid",
      sql`${table.attemptCount} >= 0`,
    ),

    check(
      "generation_jobs_max_attempts_valid",
      sql`${table.maxAttempts} > 0`,
    ),

    check(
      "generation_jobs_processing_lease_valid",
      sql`(
        ${table.status} <> 'processing'
        OR ${table.leaseExpiresAt} IS NOT NULL
      )`,
    ),

    index("generation_jobs_user_idx")
      .on(table.userId),

    index("generation_jobs_organization_idx")
      .on(table.organizationId),

    index("generation_jobs_project_idx")
      .on(table.projectId),

    index("generation_jobs_conversation_idx")
      .on(table.conversationId),

    index("generation_jobs_status_idx")
      .on(table.status),

    index("generation_jobs_priority_idx")
      .on(table.priority),

    index("generation_jobs_next_attempt_idx")
      .on(table.nextAttemptAt),

    index("generation_jobs_lease_idx")
      .on(table.leaseExpiresAt),

    index("generation_jobs_created_at_idx")
      .on(table.createdAt),
  ],
);

export const generationOutputs =
  pgTable(
    "generation_outputs",
    {
      id,


      idempotencyKey: varchar(
        "idempotency_key",
        {
          length: 255,
        },
      ).notNull(),
      jobId: uuid("job_id")
        .notNull()
        .references(() => generationJobs.id, {
          onDelete: "restrict",
          onUpdate: "cascade",
        }),

      artifactId: uuid("artifact_id")
        .references(() => artifacts.id, {
          onDelete: "restrict",
          onUpdate: "cascade",
        }),

      type: generationTypeEnum("type")
        .notNull(),

      url: varchar("url", {
        length: 4000,
      }).notNull(),

      mimeType: varchar("mime_type", {
        length: 255,
      }).notNull(),

      sizeBytes: integer(
        "size_bytes",
      ),

      metadata: jsonb("metadata"),

      createdAt,
    },
    (table) => [
      check(
        "generation_outputs_size_nonnegative",
        sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`,
      ),

      index(
        "generation_outputs_job_idx",
      ).on(table.jobId),
      index(
        "generation_outputs_type_idx",
      ).on(table.type),

      index(
        "generation_outputs_artifact_idx",
      ).on(table.artifactId),

      uniqueIndex(
        "generation_outputs_job_idempotency_unique",
      ).on(
        table.jobId,
        table.idempotencyKey,
      ),

      index(
        "generation_outputs_created_at_idx",
      ).on(table.createdAt),
    ],
  );

export type GenerationJob =
  typeof generationJobs.$inferSelect;

export type NewGenerationJob =
  typeof generationJobs.$inferInsert;

export type GenerationOutput =
  typeof generationOutputs.$inferSelect;

export type NewGenerationOutput =
  typeof generationOutputs.$inferInsert;

