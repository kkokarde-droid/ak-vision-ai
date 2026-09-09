import type { ProviderPricing } from "@ak-vision-ai/types";

export interface PricingPolicy {
  pricingVersion: string;
  currency: string;

  /**
   * Monetary value represented by one customer credit.
   * Example: 100 means ₹1.00 when currency is INR.
   */
  creditUnitMinor: number;

  /**
   * Target platform contribution in minor currency units.
   */
  platformContributionMinor: number;

  /**
   * Minimum customer charge in minor currency units.
   */
  minimumCustomerChargeMinor: number;
}

export interface GenerationPriceInput {
  providerModelId: string;
  unit: string;
  quantity: number;
  pricing: readonly ProviderPricing[];
  policy: PricingPolicy;
  asOf?: Date;
}

export interface GenerationPriceQuote {
  pricingVersion: string;
  providerModelId: string;
  currency: string;
  unit: string;
  quantity: number;
  unitPriceMinor: number;
  providerCostMinor: number;
  platformContributionMinor: number;
  customerChargeMinor: number;
  creditsRequired: number;
  quotedAt: string;
}

