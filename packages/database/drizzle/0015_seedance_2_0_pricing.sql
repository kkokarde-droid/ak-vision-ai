-- Seedance 2.0 baseline provider-cost pricing for the established T2V route.
-- Project baseline: approximately $0.25/sec converted near ₹95/USD and rounded up
-- to ₹25/sec (2500 minor units) for conservative cost accounting.
-- Do not use this as a substitute for future authoritative provider billing updates.

INSERT INTO "provider_pricing" (
  "provider_model_id",
  "currency",
  "unit",
  "unit_price_minor",
  "effective_from"
)
SELECT
  'seedance_2_0',
  'INR',
  'second',
  2500,
  TIMESTAMPTZ '2026-09-10 00:00:00+05:30'
WHERE NOT EXISTS (
  SELECT 1
  FROM "provider_pricing"
  WHERE "provider_model_id" = 'seedance_2_0'
    AND "currency" = 'INR'
    AND "unit" = 'second'
    AND "effective_from" <= TIMESTAMPTZ '2026-09-10 00:00:00+05:30'
    AND (
      "effective_to" IS NULL
      OR "effective_to" > TIMESTAMPTZ '2026-09-10 00:00:00+05:30'
    )
);
