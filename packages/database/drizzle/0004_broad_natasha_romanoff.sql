ALTER TABLE "credit_transactions" RENAME COLUMN "balance_after" TO "available_balance_after";--> statement-breakpoint
ALTER TABLE "credit_reservations" DROP CONSTRAINT "credit_reservations_credit_balance_id_credit_balances_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_reservations" DROP CONSTRAINT "credit_reservations_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_reservations" DROP CONSTRAINT "credit_reservations_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "usage_records_request_idx";--> statement-breakpoint
DROP INDEX "credit_transactions_idempotency_unique";--> statement-breakpoint
ALTER TABLE "credit_reservations" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "reserved_balance_after" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "infrastructure_cost_minor" integer;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "retry_cost_minor" integer;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "platform_contribution_minor" integer;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_credit_balance_id_credit_balances_id_fk" FOREIGN KEY ("credit_balance_id") REFERENCES "public"."credit_balances"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_reservation_id_credit_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."credit_reservations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "credit_transactions_reservation_idx" ON "credit_transactions" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_request_unique" ON "usage_records" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_idempotency_unique" ON "credit_transactions" USING btree ("idempotency_key") WHERE "credit_transactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" DROP COLUMN "platform_margin_minor";--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_available_nonnegative" CHECK ("credit_balances"."available_credits" >= 0);--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_reserved_nonnegative" CHECK ("credit_balances"."reserved_credits" >= 0);--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_currency_supported" CHECK ("credit_balances"."currency" IN ('INR', 'USD', 'EUR', 'GBP'));--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_exactly_one_owner" CHECK ((
        ("user_id" IS NOT NULL AND "organization_id" IS NULL)
        OR
        ("user_id" IS NULL AND "organization_id" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_amount_positive" CHECK ("credit_reservations"."amount" > 0);--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_status_valid" CHECK ("credit_reservations"."status" IN (
        'reserved',
        'consumed',
        'released',
        'expired'
      ));--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_lifecycle_timestamps_valid" CHECK ((
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
      ));--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_exactly_one_owner" CHECK ((
        ("user_id" IS NOT NULL AND "organization_id" IS NULL)
        OR
        ("user_id" IS NULL AND "organization_id" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_type_valid" CHECK ("credit_transactions"."type" IN (
        'grant',
        'hold',
        'consume',
        'release',
        'refund',
        'adjustment',
        'expiration'
      ));--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_source_valid" CHECK ("credit_transactions"."source" IN (
        'free',
        'purchase',
        'subscription',
        'promotion',
        'refund',
        'admin',
        'system'
      ));--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_amount_valid" CHECK ((
        ("type" = 'adjustment' AND "amount" <> 0)
        OR
        ("type" <> 'adjustment' AND "amount" > 0)
      ));--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_available_nonnegative" CHECK ("credit_transactions"."available_balance_after" >= 0);--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_reserved_nonnegative" CHECK ("credit_transactions"."reserved_balance_after" >= 0);--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_exactly_one_owner" CHECK ((
        ("user_id" IS NOT NULL AND "organization_id" IS NULL)
        OR
        ("user_id" IS NULL AND "organization_id" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_credits_nonnegative" CHECK ("usage_records"."credits_used" >= 0);--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_provider_cost_nonnegative" CHECK ("usage_records"."provider_cost_minor" IS NULL
        OR "usage_records"."provider_cost_minor" >= 0);--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_infrastructure_cost_nonnegative" CHECK ("usage_records"."infrastructure_cost_minor" IS NULL
        OR "usage_records"."infrastructure_cost_minor" >= 0);--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_retry_cost_nonnegative" CHECK ("usage_records"."retry_cost_minor" IS NULL
        OR "usage_records"."retry_cost_minor" >= 0);--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_customer_charge_nonnegative" CHECK ("usage_records"."customer_charge_minor" IS NULL
        OR "usage_records"."customer_charge_minor" >= 0);--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_currency_supported" CHECK ("usage_records"."currency" IN ('INR', 'USD', 'EUR', 'GBP'));