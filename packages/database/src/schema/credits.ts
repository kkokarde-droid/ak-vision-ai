import { sql } from "drizzle-orm";

import {
  check,
  index,
  integer,
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
import { organizations } from "./organizations.js";

export const creditBalances = pgTable(
  "credit_balances",
  {
    id,

    userId: uuid("user_id")
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    organizationId: uuid("organization_id")
      .references(() => organizations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    availableCredits: integer("available_credits")
      .notNull()
      .default(0),

    reservedCredits: integer("reserved_credits")
      .notNull()
      .default(0),

    currency: varchar("currency", {
      length: 3,
    })
      .notNull()
      .default("INR"),

    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "credit_balances_exactly_one_owner",
      sql`(
        ("user_id" IS NOT NULL AND "organization_id" IS NULL)
        OR
        ("user_id" IS NULL AND "organization_id" IS NOT NULL)
      )`,
    ),

    check(
      "credit_balances_available_nonnegative",
      sql`${table.availableCredits} >= 0`,
    ),

    check(
      "credit_balances_reserved_nonnegative",
      sql`${table.reservedCredits} >= 0`,
    ),

    check(
      "credit_balances_currency_supported",
      sql`${table.currency} IN ('INR', 'USD', 'EUR', 'GBP')`,
    ),

    uniqueIndex("credit_balances_user_individual_unique")
      .on(table.userId)
      .where(
        sql`${table.organizationId} IS NULL`,
      ),

    uniqueIndex("credit_balances_organization_unique")
      .on(table.organizationId)
      .where(
        sql`${table.organizationId} IS NOT NULL`,
      ),

    index("credit_balances_user_idx")
      .on(table.userId),

    index("credit_balances_organization_idx")
      .on(table.organizationId),

    index("credit_balances_created_at_idx")
      .on(table.createdAt),
  ],
);

export const creditReservations = pgTable(
  "credit_reservations",
  {
    id,

    creditBalanceId: uuid("credit_balance_id")
      .notNull()
      .references(() => creditBalances.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    userId: uuid("user_id")
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    organizationId: uuid("organization_id")
      .references(() => organizations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    amount: integer("amount")
      .notNull(),

    status: varchar("status", {
      length: 20,
    })
      .notNull()
      .default("reserved"),

    referenceId: varchar("reference_id", {
      length: 255,
    }),

    idempotencyKey: varchar("idempotency_key", {
      length: 255,
    })
      .notNull(),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),

    releasedAt: timestamp("released_at", {
      withTimezone: true,
      mode: "date",
    }),

    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),

    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "credit_reservations_exactly_one_owner",
      sql`(
        ("user_id" IS NOT NULL AND "organization_id" IS NULL)
        OR
        ("user_id" IS NULL AND "organization_id" IS NOT NULL)
      )`,
    ),

    check(
      "credit_reservations_amount_positive",
      sql`${table.amount} > 0`,
    ),

    check(
      "credit_reservations_status_valid",
      sql`${table.status} IN (
        'reserved',
        'consumed',
        'released',
        'expired'
      )`,
    ),

    check(
      "credit_reservations_lifecycle_timestamps_valid",
      sql`(
        ("status" = 'reserved'
          AND "released_at" IS NULL
          AND "consumed_at" IS NULL)
        OR
        ("status" = 'consumed'
          AND "consumed_at" IS NOT NULL
          AND "released_at" IS NULL)
        OR
        ("status" IN ('released', 'expired')
          AND "released_at" IS NOT NULL
          AND "consumed_at" IS NULL)
      )`,
    ),

    uniqueIndex("credit_reservations_idempotency_unique")
      .on(table.idempotencyKey),

    index("credit_reservations_balance_idx")
      .on(table.creditBalanceId),

    index("credit_reservations_user_idx")
      .on(table.userId),

    index("credit_reservations_organization_idx")
      .on(table.organizationId),

    index("credit_reservations_status_idx")
      .on(table.status),

    index("credit_reservations_expires_at_idx")
      .on(table.expiresAt),

    index("credit_reservations_created_at_idx")
      .on(table.createdAt),
  ],
);

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id,

    creditBalanceId: uuid("credit_balance_id")
      .notNull()
      .references(() => creditBalances.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    reservationId: uuid("reservation_id")
      .references(() => creditReservations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    userId: uuid("user_id")
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    organizationId: uuid("organization_id")
      .references(() => organizations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    type: varchar("type", {
      length: 30,
    })
      .notNull(),

    source: varchar("source", {
      length: 30,
    })
      .notNull(),

    amount: integer("amount")
      .notNull(),

    availableBalanceAfter: integer(
      "available_balance_after",
    )
      .notNull(),

    reservedBalanceAfter: integer(
      "reserved_balance_after",
    )
      .notNull(),

    referenceId: varchar("reference_id", {
      length: 255,
    }),

    idempotencyKey: varchar("idempotency_key", {
      length: 255,
    }),

    description: varchar("description", {
      length: 500,
    }),

    createdAt,
  },
  (table) => [
    check(
      "credit_transactions_exactly_one_owner",
      sql`(
        ("user_id" IS NOT NULL AND "organization_id" IS NULL)
        OR
        ("user_id" IS NULL AND "organization_id" IS NOT NULL)
      )`,
    ),

    check(
      "credit_transactions_type_valid",
      sql`${table.type} IN (
        'grant',
        'hold',
        'consume',
        'release',
        'refund',
        'adjustment',
        'expiration'
      )`,
    ),

    check(
      "credit_transactions_source_valid",
      sql`${table.source} IN (
        'free',
        'purchase',
        'subscription',
        'promotion',
        'refund',
        'admin',
        'system'
      )`,
    ),

    check(
      "credit_transactions_amount_valid",
      sql`(
        ("type" = 'adjustment' AND "amount" <> 0)
        OR
        ("type" <> 'adjustment' AND "amount" > 0)
      )`,
    ),

    check(
      "credit_transactions_available_nonnegative",
      sql`${table.availableBalanceAfter} >= 0`,
    ),

    check(
      "credit_transactions_reserved_nonnegative",
      sql`${table.reservedBalanceAfter} >= 0`,
    ),

    uniqueIndex("credit_transactions_idempotency_unique")
      .on(table.idempotencyKey)
      .where(
        sql`${table.idempotencyKey} IS NOT NULL`,
      ),

    index("credit_transactions_balance_idx")
      .on(table.creditBalanceId),

    index("credit_transactions_reservation_idx")
      .on(table.reservationId),

    index("credit_transactions_user_idx")
      .on(table.userId),

    index("credit_transactions_organization_idx")
      .on(table.organizationId),

    index("credit_transactions_type_idx")
      .on(table.type),

    index("credit_transactions_reference_idx")
      .on(table.referenceId),

    index("credit_transactions_created_at_idx")
      .on(table.createdAt),
  ],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id,

    requestId: uuid("request_id")
      .notNull(),

    reservationId: uuid("reservation_id")
      .references(() => creditReservations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    userId: uuid("user_id")
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    organizationId: uuid("organization_id")
      .references(() => organizations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    providerId: varchar("provider_id", {
      length: 100,
    }),

    providerModelId: varchar("provider_model_id", {
      length: 150,
    }),

    creditsUsed: integer("credits_used")
      .notNull()
      .default(0),

    providerCostMinor: integer(
      "provider_cost_minor",
    ),

    infrastructureCostMinor: integer(
      "infrastructure_cost_minor",
    ),

    retryCostMinor: integer(
      "retry_cost_minor",
    ),

    customerChargeMinor: integer(
      "customer_charge_minor",
    ),

    platformContributionMinor: integer(
      "platform_contribution_minor",
    ),

    currency: varchar("currency", {
      length: 3,
    })
      .notNull()
      .default("INR"),

    createdAt,
  },
  (table) => [
    check(
      "usage_records_exactly_one_owner",
      sql`(
        ("user_id" IS NOT NULL AND "organization_id" IS NULL)
        OR
        ("user_id" IS NULL AND "organization_id" IS NOT NULL)
      )`,
    ),

    check(
      "usage_records_credits_nonnegative",
      sql`${table.creditsUsed} >= 0`,
    ),

    check(
      "usage_records_provider_cost_nonnegative",
      sql`${table.providerCostMinor} IS NULL
        OR ${table.providerCostMinor} >= 0`,
    ),

    check(
      "usage_records_infrastructure_cost_nonnegative",
      sql`${table.infrastructureCostMinor} IS NULL
        OR ${table.infrastructureCostMinor} >= 0`,
    ),

    check(
      "usage_records_retry_cost_nonnegative",
      sql`${table.retryCostMinor} IS NULL
        OR ${table.retryCostMinor} >= 0`,
    ),

    check(
      "usage_records_customer_charge_nonnegative",
      sql`${table.customerChargeMinor} IS NULL
        OR ${table.customerChargeMinor} >= 0`,
    ),

    check(
      "usage_records_currency_supported",
      sql`${table.currency} IN ('INR', 'USD', 'EUR', 'GBP')`,
    ),

    uniqueIndex("usage_records_request_unique")
      .on(table.requestId),

    index("usage_records_reservation_idx")
      .on(table.reservationId),

    index("usage_records_user_idx")
      .on(table.userId),

    index("usage_records_organization_idx")
      .on(table.organizationId),

    index("usage_records_provider_idx")
      .on(table.providerId),

    index("usage_records_provider_model_idx")
      .on(table.providerModelId),

    index("usage_records_created_at_idx")
      .on(table.createdAt),
  ],
);

export type CreditBalance =
  typeof creditBalances.$inferSelect;

export type NewCreditBalance =
  typeof creditBalances.$inferInsert;

export type CreditReservation =
  typeof creditReservations.$inferSelect;

export type NewCreditReservation =
  typeof creditReservations.$inferInsert;

export type CreditTransaction =
  typeof creditTransactions.$inferSelect;

export type NewCreditTransaction =
  typeof creditTransactions.$inferInsert;

export type UsageRecord =
  typeof usageRecords.$inferSelect;

export type NewUsageRecord =
  typeof usageRecords.$inferInsert;
