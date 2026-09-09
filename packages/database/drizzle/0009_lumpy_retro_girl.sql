CREATE TABLE "pricing_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricing_version" varchar(100) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"credit_unit_minor" integer NOT NULL,
	"platform_contribution_minor" integer NOT NULL,
	"minimum_customer_charge_minor" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_policies_credit_unit_positive" CHECK ("pricing_policies"."credit_unit_minor" > 0),
	CONSTRAINT "pricing_policies_contribution_nonnegative" CHECK ("pricing_policies"."platform_contribution_minor" >= 0),
	CONSTRAINT "pricing_policies_minimum_charge_nonnegative" CHECK ("pricing_policies"."minimum_customer_charge_minor" >= 0),
	CONSTRAINT "pricing_policies_effective_window_valid" CHECK ("pricing_policies"."effective_to" IS NULL OR "pricing_policies"."effective_to" > "pricing_policies"."effective_from"),
	CONSTRAINT "pricing_policies_currency_valid" CHECK (length("pricing_policies"."currency") = 3 AND "pricing_policies"."currency" = upper("pricing_policies"."currency"))
);
--> statement-breakpoint
CREATE TABLE "provider_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_model_id" varchar(150) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"unit" varchar(50) NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_pricing_unit_price_positive" CHECK ("provider_pricing"."unit_price_minor" > 0),
	CONSTRAINT "provider_pricing_effective_window_valid" CHECK ("provider_pricing"."effective_to" IS NULL OR "provider_pricing"."effective_to" > "provider_pricing"."effective_from"),
	CONSTRAINT "provider_pricing_currency_valid" CHECK (length("provider_pricing"."currency") = 3 AND "provider_pricing"."currency" = upper("provider_pricing"."currency"))
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
CREATE INDEX "pricing_policies_lookup_idx" ON "pricing_policies" USING btree ("currency","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_policies_version_idx" ON "pricing_policies" USING btree ("pricing_version","currency","effective_from");--> statement-breakpoint
CREATE INDEX "provider_pricing_model_idx" ON "provider_pricing" USING btree ("provider_model_id");--> statement-breakpoint
CREATE INDEX "provider_pricing_lookup_idx" ON "provider_pricing" USING btree ("provider_model_id","currency","unit","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_pricing_identity_idx" ON "provider_pricing" USING btree ("provider_model_id","currency","unit","effective_from");