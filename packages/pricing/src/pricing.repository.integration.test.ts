import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import {
  db,
  pricingPolicies,
  providerPricing,
} from "@ak-vision-ai/database";

import {
  PricingError,
  resolveGenerationPricing,
} from "./index.js";

async function insertPolicy(
  input: {
    pricingVersion: string;
    currency?: string;
    effectiveFrom: Date;
    effectiveTo?: Date;
  },
) {
  const result =
    await db
      .insert(pricingPolicies)
      .values({
        pricingVersion:
          input.pricingVersion,
        currency:
          input.currency ?? "INR",
        creditUnitMinor:
          100,
        platformContributionMinor:
          10000,
        minimumCustomerChargeMinor:
          15000,
        effectiveFrom:
          input.effectiveFrom,
        effectiveTo:
          input.effectiveTo,
      })
      .returning();

  assert.ok(result[0]);
  return result[0];
}

async function insertPricing(
  input: {
    providerModelId: string;
    currency?: string;
    effectiveFrom: Date;
    effectiveTo?: Date;
    unitPriceMinor?: number;
  },
) {
  const result =
    await db
      .insert(providerPricing)
      .values({
        providerModelId:
          input.providerModelId,
        currency:
          input.currency ?? "INR",
        unit:
          "second",
        unitPriceMinor:
          input.unitPriceMinor ?? 250,
        effectiveFrom:
          input.effectiveFrom,
        effectiveTo:
          input.effectiveTo,
      })
      .returning();

  assert.ok(result[0]);
  return result[0];
}

test(
  "pricing repository resolves active provider pricing and policy",
  async () => {
    const model =
      `integration-model-${randomUUID()}`;

    const policy =
  await insertPolicy({
    pricingVersion:
      `historical-${randomUUID()}`,
    currency:
      "TST",
    effectiveFrom:
      new Date(
        "2026-01-01T00:00:00.000Z",
      ),
  });

    const pricing =
  await insertPricing({
    providerModelId:
      model,
    currency:
      "TST",
    effectiveFrom:
      new Date(
        "2026-01-01T00:00:00.000Z",
      ),
    unitPriceMinor:
      250,
  });

    try {
      const resolved =
        await resolveGenerationPricing({
          providerModelId:
            model,
          unit:
            "second",
          currency:
            "TST",
          asOf:
            new Date(
              "2026-09-03T00:00:00.000Z",
            ),
        });

      assert.equal(
        resolved.pricingId,
        pricing.id,
      );

      assert.equal(
        resolved.policyId,
        policy.id,
      );

      assert.equal(
        resolved.pricing[0]?.unitPriceMinor,
        250,
      );

      assert.equal(
        resolved.policy.pricingVersion,
        policy.pricingVersion,
      );
    } finally {
      await db
        .delete(providerPricing)
        .where(
          eq(
            providerPricing.id,
            pricing.id,
          ),
        );

      await db
        .delete(pricingPolicies)
        .where(
          eq(
            pricingPolicies.id,
            policy.id,
          ),
        );
    }
  },
);

test(
  "pricing repository resolves historical effective pricing",
  async () => {
    const model =
      `historical-model-${randomUUID()}`;

    const policy =
  await insertPolicy({
    pricingVersion:
      `historical-${randomUUID()}`,
    currency:
      "HIS",
    effectiveFrom:
      new Date(
        "2026-01-01T00:00:00.000Z",
      ),
  });

    const oldPricing =
  await insertPricing({
    providerModelId:
      model,
    currency:
      "HIS",
    effectiveFrom:
      new Date(
        "2026-01-01T00:00:00.000Z",
      ),
    effectiveTo:
      new Date(
        "2026-06-01T00:00:00.000Z",
      ),
    unitPriceMinor:
      200,
  });

    const newPricing =
  await insertPricing({
    providerModelId:
      model,
    currency:
      "HIS",
    effectiveFrom:
      new Date(
        "2026-06-01T00:00:00.000Z",
      ),
    unitPriceMinor:
      250,
  });

    try {
      const resolved =
        await resolveGenerationPricing({
          providerModelId:
            model,
          unit:
            "second",
          currency:
            "HIS",
          asOf:
            new Date(
              "2026-05-01T00:00:00.000Z",
            ),
        });

      assert.equal(
        resolved.pricingId,
        oldPricing.id,
      );

      assert.equal(
        resolved.pricing[0]?.unitPriceMinor,
        200,
      );
    } finally {
      await db
        .delete(providerPricing)
        .where(
          eq(
            providerPricing.id,
            oldPricing.id,
          ),
        );

      await db
        .delete(providerPricing)
        .where(
          eq(
            providerPricing.id,
            newPricing.id,
          ),
        );

      await db
        .delete(pricingPolicies)
        .where(
          eq(
            pricingPolicies.id,
            policy.id,
          ),
        );
    }
  },
);

test(
  "pricing repository rejects overlapping active provider pricing",
  async () => {
const model =
      randomUUID();
    const policy =
  await insertPolicy({
    pricingVersion:
      `conflict-${randomUUID()}`,
    currency:
      "CFL",
    effectiveFrom:
      new Date(
        "2026-01-01T00:00:00.000Z",
      ),
  });

    const first =
  await insertPricing({
    providerModelId:
      model,
    currency:
      "TST",
    effectiveFrom:
      new Date(
        "2026-01-01T00:00:00.000Z",
      ),
  });

    await assert.rejects(
      () =>
        insertPricing({
          providerModelId:
            model,
          currency:
            "TST",
          effectiveFrom:
            new Date(
              "2026-06-01T00:00:00.000Z",
            ),
        }),
      (error: unknown) =>
        (error as any)?.cause?.code ===
          "23P01" &&
        (error as any)?.cause?.constraint ===
          "provider_pricing_no_overlapping_effective_windows",
    );

    
      await db
        .delete(pricingPolicies)
        .where(
          eq(
            pricingPolicies.id,
            policy.id,
          ),
        );
    
  },
);

