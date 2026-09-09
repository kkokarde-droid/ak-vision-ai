CREATE EXTENSION IF NOT EXISTS btree_gist;

--> statement-breakpoint

ALTER TABLE "provider_pricing"
ADD CONSTRAINT "provider_pricing_no_overlapping_effective_windows"
EXCLUDE USING gist (
  "provider_model_id" WITH =,
  "currency" WITH =,
  "unit" WITH =,
  tstzrange(
    "effective_from",
    COALESCE(
      "effective_to",
      'infinity'::timestamptz
    ),
    '[)'
  ) WITH &&
);

--> statement-breakpoint

ALTER TABLE "pricing_policies"
ADD CONSTRAINT "pricing_policies_no_overlapping_effective_windows"
EXCLUDE USING gist (
  "currency" WITH =,
  tstzrange(
    "effective_from",
    COALESCE(
      "effective_to",
      'infinity'::timestamptz
    ),
    '[)'
  ) WITH &&
);