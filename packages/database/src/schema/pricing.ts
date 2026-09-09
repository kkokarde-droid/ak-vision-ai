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

export const providerPricing = pgTable(
  "provider_pricing",
  {
    id,

    providerModelId: varchar(
      "provider_model_id",
      {
        length: 150,
      },
    ).notNull(),

    currency: varchar(
      "currency",
      {
        length: 3,
      },
    ).notNull(),

    unit: varchar(
      "unit",
      {
        length: 50,
      },
    ).notNull(),

    unitPriceMinor: integer(
      "unit_price_minor",
    ).notNull(),

    effectiveFrom: timestamp(
      "effective_from",
      {
        withTimezone: true,
        mode: "date",
      },
    ).notNull(),

    effectiveTo: timestamp(
      "effective_to",
      {
        withTimezone: true,
        mode: "date",
      },
    ),

    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "provider_pricing_unit_price_positive",
      sql`${table.unitPriceMinor} > 0`,
    ),

    check(
      "provider_pricing_effective_window_valid",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),

    check(
      "provider_pricing_currency_valid",
      sql`length(${table.currency}) = 3 AND ${table.currency} = upper(${table.currency})`,
    ),

    index(
      "provider_pricing_model_idx",
    ).on(table.providerModelId),

    index(
      "provider_pricing_lookup_idx",
    ).on(
      table.providerModelId,
      table.currency,
      table.unit,
      table.effectiveFrom,
    ),

    uniqueIndex(
      "provider_pricing_identity_idx",
    ).on(
      table.providerModelId,
      table.currency,
      table.unit,
      table.effectiveFrom,
    ),
  ],
);

export const pricingPolicies = pgTable(
  "pricing_policies",
  {
    id,

    pricingVersion: varchar(
      "pricing_version",
      {
        length: 100,
      },
    ).notNull(),

    currency: varchar(
      "currency",
      {
        length: 3,
      },
    ).notNull(),

    creditUnitMinor: integer(
      "credit_unit_minor",
    ).notNull(),

    platformContributionMinor: integer(
      "platform_contribution_minor",
    ).notNull(),

    minimumCustomerChargeMinor: integer(
      "minimum_customer_charge_minor",
    ).notNull(),

    effectiveFrom: timestamp(
      "effective_from",
      {
        withTimezone: true,
        mode: "date",
      },
    ).notNull(),

    effectiveTo: timestamp(
      "effective_to",
      {
        withTimezone: true,
        mode: "date",
      },
    ),

    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "pricing_policies_credit_unit_positive",
      sql`${table.creditUnitMinor} > 0`,
    ),

    check(
      "pricing_policies_contribution_nonnegative",
      sql`${table.platformContributionMinor} >= 0`,
    ),

    check(
      "pricing_policies_minimum_charge_nonnegative",
      sql`${table.minimumCustomerChargeMinor} >= 0`,
    ),

    check(
      "pricing_policies_effective_window_valid",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),

    check(
      "pricing_policies_currency_valid",
      sql`length(${table.currency}) = 3 AND ${table.currency} = upper(${table.currency})`,
    ),

    index(
      "pricing_policies_lookup_idx",
    ).on(
      table.currency,
      table.effectiveFrom,
    ),

    uniqueIndex(
      "pricing_policies_version_idx",
    ).on(
      table.pricingVersion,
      table.currency,
      table.effectiveFrom,
    ),
  ],
);

export type ProviderPricingRecord =
  typeof providerPricing.$inferSelect;

export type NewProviderPricingRecord =
  typeof providerPricing.$inferInsert;

export type PricingPolicyRecord =
  typeof pricingPolicies.$inferSelect;

export type NewPricingPolicyRecord =
  typeof pricingPolicies.$inferInsert;
