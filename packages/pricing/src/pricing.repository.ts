import {
  and,
  eq,
  gt,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import {
  db,
  pricingPolicies,
  providerPricing,
} from "@ak-vision-ai/database";

import type { ProviderPricing } from "@ak-vision-ai/types";

import { PricingError } from "./pricing.errors.js";
import type {
  PricingPolicy,
} from "./pricing.types.js";

export type PricingTransaction =
  Parameters<
    Parameters<typeof db.transaction>[0]
  >[0];

export type ResolvedGenerationPricing = {
  pricingId: string;
  policyId: string;
  pricing: ProviderPricing[];
  policy: PricingPolicy;
};

function normalizeCurrency(
  currency: string,
): string {
  return currency.trim().toUpperCase();
}

function validateInput(
  input: {
    providerModelId: string;
    unit: string;
    currency: string;
    asOf?: Date;
  },
) {
  if (!input.providerModelId.trim()) {
    throw new PricingError(
      "providerModelId is required",
      "INVALID_INPUT",
    );
  }

  if (!input.unit.trim()) {
    throw new PricingError(
      "unit is required",
      "INVALID_INPUT",
    );
  }

  const currency =
    normalizeCurrency(input.currency);

  if (!currency) {
    throw new PricingError(
      "currency is required",
      "UNSUPPORTED_CURRENCY",
    );
  }

  const asOf =
    input.asOf ?? new Date();

  if (Number.isNaN(asOf.getTime())) {
    throw new PricingError(
      "asOf must be a valid date",
      "INVALID_INPUT",
    );
  }

  return {
    currency,
    asOf,
  };
}

export async function resolveGenerationPricingTx(
  tx: PricingTransaction,
  input: {
    providerModelId: string;
    unit: string;
    currency: string;
    asOf?: Date;
  },
): Promise<ResolvedGenerationPricing> {
  const {
    currency,
    asOf,
  } = validateInput(input);

  const pricingRows =
    await tx
      .select()
      .from(providerPricing)
      .where(
        and(
          eq(
            providerPricing.providerModelId,
            input.providerModelId,
          ),
          eq(
            providerPricing.currency,
            currency,
          ),
          eq(
            providerPricing.unit,
            input.unit,
          ),
          lte(
            providerPricing.effectiveFrom,
            asOf,
          ),
          or(
            isNull(
              providerPricing.effectiveTo,
            ),
            gt(
              providerPricing.effectiveTo,
              asOf,
            ),
          ),
        ),
      );

  const policyRows =
    await tx
      .select()
      .from(pricingPolicies)
      .where(
        and(
          eq(
            pricingPolicies.currency,
            currency,
          ),
          lte(
            pricingPolicies.effectiveFrom,
            asOf,
          ),
          or(
            isNull(
              pricingPolicies.effectiveTo,
            ),
            gt(
              pricingPolicies.effectiveTo,
              asOf,
            ),
          ),
        ),
      );

  if (pricingRows.length === 0) {
    throw new PricingError(
      `No active pricing found for provider model ${input.providerModelId}, unit ${input.unit}, currency ${currency}`,
      "PRICING_NOT_FOUND",
    );
  }

  if (pricingRows.length > 1) {
    throw new PricingError(
      `Multiple active pricing records found for provider model ${input.providerModelId}, unit ${input.unit}, currency ${currency}`,
      "PRICING_CONFLICT",
    );
  }

  if (policyRows.length === 0) {
    throw new PricingError(
      `No active pricing policy found for currency ${currency}`,
      "PRICING_NOT_FOUND",
    );
  }

  if (policyRows.length > 1) {
    throw new PricingError(
      `Multiple active pricing policies found for currency ${currency}`,
      "PRICING_CONFLICT",
    );
  }

  const pricingRow =
    pricingRows[0];

  const policyRow =
    policyRows[0];

  if (!pricingRow || !policyRow) {
    throw new PricingError(
      "Authoritative pricing could not be resolved",
      "PRICING_NOT_FOUND",
    );
  }

  const pricing: ProviderPricing = {
    id:
      pricingRow.id,
    providerModelId:
      pricingRow.providerModelId,
    currency:
      pricingRow.currency,
    unit:
      pricingRow.unit,
    unitPriceMinor:
      pricingRow.unitPriceMinor,
    effectiveFrom:
      pricingRow.effectiveFrom.toISOString(),
    ...(pricingRow.effectiveTo
      ? {
          effectiveTo:
            pricingRow.effectiveTo.toISOString(),
        }
      : {}),
  };

  return {
    pricingId:
      pricingRow.id,
    policyId:
      policyRow.id,
    pricing: [pricing],
    policy: {
      pricingVersion:
        policyRow.pricingVersion,
      currency:
        policyRow.currency,
      creditUnitMinor:
        policyRow.creditUnitMinor,
      platformContributionMinor:
        policyRow.platformContributionMinor,
      minimumCustomerChargeMinor:
        policyRow.minimumCustomerChargeMinor,
    },
  };
}

export async function resolveGenerationPricing(
  input: {
    providerModelId: string;
    unit: string;
    currency: string;
    asOf?: Date;
  },
): Promise<ResolvedGenerationPricing> {
  return db.transaction(
    async (tx) =>
      resolveGenerationPricingTx(
        tx,
        input,
      ),
  );
}
