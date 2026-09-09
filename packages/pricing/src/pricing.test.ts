import test from "node:test";
import assert from "node:assert/strict";

import type { ProviderPricing } from "@ak-vision-ai/types";

import { calculateGenerationPrice } from "./pricing.js";
import { PricingError } from "./pricing.errors.js";

const pricing: ProviderPricing[] = [
  {
    id: "pricing-1",
    providerModelId: "hf-model-1",
    currency: "INR",
    unit: "second",
    unitPriceMinor: 250,
    effectiveFrom:
      "2026-06-01T00:00:00.000Z",
  },
];

const basePricing =
  pricing[0]!;

const policy = {
  pricingVersion: "v1",
  currency: "INR",
  creditUnitMinor: 100,
  platformContributionMinor: 10000,
  minimumCustomerChargeMinor: 15000,
};

test(
  "calculates deterministic generation price",
  () => {
    const quote =
      calculateGenerationPrice({
        providerModelId:
          "hf-model-1",
        unit:
          "second",
        quantity:
          20,
        pricing,
        policy,
        asOf:
          new Date(
            "2026-09-03T00:00:00.000Z",
          ),
      });

    assert.equal(
      quote.providerModelId,
      "hf-model-1",
    );

    assert.equal(
      quote.providerCostMinor,
      5000,
    );

    assert.equal(
      quote.platformContributionMinor,
      10000,
    );

    assert.equal(
      quote.customerChargeMinor,
      15000,
    );

    assert.equal(
      quote.creditsRequired,
      150,
    );

    assert.equal(
      quote.pricingVersion,
      "v1",
    );
  },
);

test(
  "rejects missing active pricing",
  () => {
    assert.throws(
      () =>
        calculateGenerationPrice({
          providerModelId:
            "missing-model",
          unit:
            "second",
          quantity:
            20,
          pricing,
          policy,
        }),
      (error: unknown) =>
        error instanceof PricingError &&
        error.code ===
          "PRICING_NOT_FOUND",
    );
  },
);

test(
  "rejects conflicting active pricing",
  () => {
    const conflicting:
      ProviderPricing[] =
      [
        ...pricing,
        {
          ...basePricing,
          id:
            "pricing-2",
        },
      ];

    assert.throws(
      () =>
        calculateGenerationPrice({
          providerModelId:
            "hf-model-1",
          unit:
            "second",
          quantity:
            20,
          pricing:
            conflicting,
          policy,
        }),
      (error: unknown) =>
        error instanceof PricingError &&
        error.code ===
          "PRICING_CONFLICT",
    );
  },
);

test(
  "rejects invalid quantity",
  () => {
    assert.throws(
      () =>
        calculateGenerationPrice({
          providerModelId:
            "hf-model-1",
          unit:
            "second",
          quantity:
            0,
          pricing,
          policy,
        }),
      (error: unknown) =>
        error instanceof PricingError &&
        error.code ===
          "INVALID_INPUT",
    );
  },
);

test(
  "uses historical effective pricing",
  () => {
    const historical:
      ProviderPricing[] =
      [
        {
          ...basePricing,
          id:
            "pricing-old",
          unitPriceMinor:
            200,
          effectiveFrom:
            "2026-01-01T00:00:00.000Z",
          effectiveTo:
            "2026-06-01T00:00:00.000Z",
        },
        basePricing,
      ];

    const quote =
      calculateGenerationPrice({
        providerModelId:
          "hf-model-1",
        unit:
          "second",
        quantity:
          10,
        pricing:
          historical,
        policy,
        asOf:
          new Date(
            "2026-05-01T00:00:00.000Z",
          ),
      });

    assert.equal(
      quote.unitPriceMinor,
      200,
    );

    assert.equal(
      quote.providerCostMinor,
      2000,
    );
  },
);

test(
  "rounds customer charge up to whole credits",
  () => {
    const quote =
      calculateGenerationPrice({
        providerModelId:
          "hf-model-1",
        unit:
          "second",
        quantity:
          1,
        pricing,
        policy: {
          ...policy,
          platformContributionMinor:
            0,
          minimumCustomerChargeMinor:
            0,
          creditUnitMinor:
            100,
        },
      });

    assert.equal(
      quote.providerCostMinor,
      250,
    );

    assert.equal(
      quote.customerChargeMinor,
      250,
    );

    assert.equal(
      quote.creditsRequired,
      3,
    );
  },
);



