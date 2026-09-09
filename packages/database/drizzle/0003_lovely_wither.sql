CREATE TABLE "credit_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"available_credits" integer DEFAULT 0 NOT NULL,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_exactly_one_owner" CHECK ((
        ("user_id" IS NOT NULL AND "organization_id" IS NULL)
        OR
        ("user_id" IS NULL AND "organization_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "credit_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_balance_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"amount" integer NOT NULL,
	"status" varchar(20) DEFAULT 'reserved' NOT NULL,
	"reference_id" varchar(255),
	"idempotency_key" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_balance_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"type" varchar(30) NOT NULL,
	"source" varchar(30) NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reference_id" varchar(255),
	"idempotency_key" varchar(255),
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"provider_id" varchar(100),
	"provider_model_id" varchar(150),
	"credits_used" integer DEFAULT 0 NOT NULL,
	"provider_cost_minor" integer,
	"customer_charge_minor" integer,
	"platform_margin_minor" integer,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_credit_balance_id_credit_balances_id_fk" FOREIGN KEY ("credit_balance_id") REFERENCES "public"."credit_balances"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_credit_balance_id_credit_balances_id_fk" FOREIGN KEY ("credit_balance_id") REFERENCES "public"."credit_balances"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_balances_user_individual_unique" ON "credit_balances" USING btree ("user_id") WHERE "credit_balances"."organization_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_balances_organization_unique" ON "credit_balances" USING btree ("organization_id") WHERE "credit_balances"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_balances_user_idx" ON "credit_balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_balances_organization_idx" ON "credit_balances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "credit_balances_created_at_idx" ON "credit_balances" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_reservations_idempotency_unique" ON "credit_reservations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_reservations_balance_idx" ON "credit_reservations" USING btree ("credit_balance_id");--> statement-breakpoint
CREATE INDEX "credit_reservations_user_idx" ON "credit_reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_reservations_organization_idx" ON "credit_reservations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "credit_reservations_status_idx" ON "credit_reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_reservations_expires_at_idx" ON "credit_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "credit_reservations_created_at_idx" ON "credit_reservations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_idempotency_unique" ON "credit_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_transactions_balance_idx" ON "credit_transactions" USING btree ("credit_balance_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_user_idx" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_organization_idx" ON "credit_transactions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_type_idx" ON "credit_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "credit_transactions_reference_idx" ON "credit_transactions" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_created_at_idx" ON "credit_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_records_request_idx" ON "usage_records" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "usage_records_user_idx" ON "usage_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_records_organization_idx" ON "usage_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "usage_records_provider_idx" ON "usage_records" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "usage_records_provider_model_idx" ON "usage_records" USING btree ("provider_model_id");--> statement-breakpoint
CREATE INDEX "usage_records_created_at_idx" ON "usage_records" USING btree ("created_at");