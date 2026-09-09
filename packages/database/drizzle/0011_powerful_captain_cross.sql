CREATE TYPE "public"."auth_identity_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TYPE "public"."auth_oauth_intent" AS ENUM('login', 'link');--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "auth_identity_provider" NOT NULL,
	"provider_subject" varchar(512) NOT NULL,
	"provider_email" varchar(320),
	"provider_email_verified" boolean DEFAULT false NOT NULL,
	"provider_display_name" varchar(120),
	"provider_avatar_url" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "auth_identity_provider" NOT NULL,
	"intent" "auth_oauth_intent" NOT NULL,
	"user_id" uuid,
	"state_hash" varchar(64) NOT NULL,
	"code_verifier" varchar(128) NOT NULL,
	"nonce" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_oauth_states_link_requires_user" CHECK ((
          "auth_oauth_states"."intent" <> 'link'
          OR "auth_oauth_states"."user_id" IS NOT NULL
        ))
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "auth_oauth_states" ADD CONSTRAINT "auth_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_subject_unique" ON "auth_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_user_provider_unique" ON "auth_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "auth_identities_user_idx" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_identities_provider_email_idx" ON "auth_identities" USING btree ("provider_email");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_oauth_states_state_hash_unique" ON "auth_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "auth_oauth_states_expires_at_idx" ON "auth_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_oauth_states_user_idx" ON "auth_oauth_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_states_consumed_at_idx" ON "auth_oauth_states" USING btree ("consumed_at");--> statement-breakpoint
CREATE INDEX "auth_oauth_states_created_at_idx" ON "auth_oauth_states" USING btree ("created_at");