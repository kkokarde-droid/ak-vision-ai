import type { ProviderPricing } from "@ak-vision-ai/types";
import { PricingError } from "./pricing.errors.js";
import type {
  GenerationPriceInput,
  GenerationPriceQuote,
} from "./pricing.types.js";

function assertSafeNonNegativeInteger(
  value: number,
  field: string,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new PricingError(
      `${field} must be a non-negative safe integer`,
      "INVALID_INPUT",
    );
  }
}

function normalizeCurrency(
  value: string,
): string {
  return value.trim().toUpperCase();
}

function isActivePricing(
  entry: ProviderPricing,
  at: Date,
): boolean {
  const effectiveFrom =
    new Date(entry.effectiveFrom);

  if (
    Number.isNaN(
      effectiveFrom.getTime(),
    )
  ) {
    throw new PricingError(
      `Invalid effectiveFrom for pricing ${entry.id}`,
      "INVALID_INPUT",
    );
  }

  if (effectiveFrom > at) {
    return false;
  }

  if (!entry.effectiveTo) {
    return true;
  }

  const effectiveTo =
    new Date(entry.effectiveTo);

  if (
    Number.isNaN(
      effectiveTo.getTime(),
    )
  ) {
    throw new PricingError(
      `Invalid effectiveTo for pricing ${entry.id}`,
      "INVALID_INPUT",
    );
  }

  if (effectiveTo <= effectiveFrom) {
    throw new PricingError(
      `effectiveTo must be later than effectiveFrom for pricing ${entry.id}`,
      "INVALID_INPUT",
    );
  }

  return at < effectiveTo;
}

function resolvePricing(
  input: GenerationPriceInput,
  currency: string,
  at: Date,
): ProviderPricing {
  const matches =
    input.pricing.filter(
      (entry) =>
        entry.providerModelId ===
          input.providerModelId &&
        normalizeCurrency(
          entry.currency,
        ) === currency &&
        entry.unit === input.unit &&
        isActivePricing(entry, at),
    );

  if (matches.length === 0) {
    throw new PricingError(
      `No active pricing found for provider model ${input.providerModelId}, unit ${input.unit}, currency ${currency}`,
      "PRICING_NOT_FOUND",
    );
  }

  if (matches.length > 1) {
    throw new PricingError(
      `Multiple active pricing records found for provider model ${input.providerModelId}, unit ${input.unit}, currency ${currency}`,
      "PRICING_CONFLICT",
    );
  }

  const match = matches[0];

  if (!match) {
    throw new PricingError(
      "Active pricing could not be resolved",
      "PRICING_NOT_FOUND",
    );
  }

  return match;
}

export function calculateGenerationPrice(
  input: GenerationPriceInput,
): GenerationPriceQuote {
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

  assertSafeNonNegativeInteger(
    input.quantity,
    "quantity",
  );

  if (input.quantity <= 0) {
    throw new PricingError(
      "quantity must be greater than zero",
      "INVALID_INPUT",
    );
  }

  const policy =
    input.policy;

  if (!policy.pricingVersion.trim()) {
    throw new PricingError(
      "pricingVersion is required",
      "INVALID_INPUT",
    );
  }

  const currency =
    normalizeCurrency(
      policy.currency,
    );

  if (!currency) {
    throw new PricingError(
      "currency is required",
      "UNSUPPORTED_CURRENCY",
    );
  }

  assertSafeNonNegativeInteger(
    policy.creditUnitMinor,
    "creditUnitMinor",
  );

  if (policy.creditUnitMinor <= 0) {
    throw new PricingError(
      "creditUnitMinor must be greater than zero",
      "INVALID_INPUT",
    );
  }

  assertSafeNonNegativeInteger(
    policy.platformContributionMinor,
    "platformContributionMinor",
  );

  assertSafeNonNegativeInteger(
    policy.minimumCustomerChargeMinor,
    "minimumCustomerChargeMinor",
  );

  const at =
    input.asOf ?? new Date();

  if (Number.isNaN(at.getTime())) {
    throw new PricingError(
      "asOf must be a valid date",
      "INVALID_INPUT",
    );
  }

  const pricing =
    resolvePricing(
      input,
      currency,
      at,
    );

  assertSafeNonNegativeInteger(
    pricing.unitPriceMinor,
    "unitPriceMinor",
  );

  if (pricing.unitPriceMinor <= 0) {
    throw new PricingError(
      "unitPriceMinor must be greater than zero",
      "INVALID_INPUT",
    );
  }

  const providerCostMinor =
    pricing.unitPriceMinor *
    input.quantity;

  if (
    !Number.isSafeInteger(
      providerCostMinor,
    )
  ) {
    throw new PricingError(
      "Calculated provider cost exceeds safe integer range",
      "INVALID_INPUT",
    );
  }

  const costPlusContribution =
    providerCostMinor +
    policy.platformContributionMinor;

  if (
    !Number.isSafeInteger(
      costPlusContribution,
    )
  ) {
    throw new PricingError(
      "Calculated customer charge exceeds safe integer range",
      "INVALID_INPUT",
    );
  }

  const customerChargeMinor =
    Math.max(
      costPlusContribution,
      policy.minimumCustomerChargeMinor,
    );

  const creditsRequired =
    Math.ceil(
      customerChargeMinor /
        policy.creditUnitMinor,
    );

  if (
    !Number.isSafeInteger(
      creditsRequired,
    ) ||
    creditsRequired <= 0
  ) {
    throw new PricingError(
      "Calculated credit requirement is invalid",
      "INVALID_INPUT",
    );
  }

  return {
    pricingVersion:
      policy.pricingVersion,
    providerModelId:
      pricing.providerModelId,
    currency,
    unit:
      pricing.unit,
    quantity:
      input.quantity,
    unitPriceMinor:
      pricing.unitPriceMinor,
    providerCostMinor,
    platformContributionMinor:
      policy.platformContributionMinor,
    customerChargeMinor,
    creditsRequired,
    quotedAt:
      at.toISOString(),
  };
}



