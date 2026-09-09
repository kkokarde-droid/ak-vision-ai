CREATE TYPE "public"."artifact_status" AS ENUM('draft', 'processing', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('document', 'spreadsheet', 'presentation', 'image', 'video', 'audio', 'code', 'website', 'webpage', 'mobile-app', 'desktop-app', 'pdf', 'data', 'other');--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_url" varchar(4000),
	"preview_url" varchar(4000),
	"change_summary" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_versions_version_valid" CHECK ("artifact_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"conversation_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"organization_id" uuid,
	"name" varchar(500) NOT NULL,
	"type" "artifact_type" NOT NULL,
	"status" "artifact_status" DEFAULT 'processing' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"mime_type" varchar(255),
	"size_bytes" integer,
	"storage_url" varchar(4000),
	"preview_url" varchar(4000),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_version_valid" CHECK ("artifacts"."version" > 0),
	CONSTRAINT "artifacts_size_nonnegative" CHECK ("artifacts"."size_bytes" IS NULL OR "artifacts"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_artifact_version_unique" ON "artifact_versions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE INDEX "artifact_versions_artifact_idx" ON "artifact_versions" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "artifact_versions_created_at_idx" ON "artifact_versions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "artifacts_owner_user_idx" ON "artifacts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "artifacts_organization_idx" ON "artifacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "artifacts_conversation_idx" ON "artifacts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "artifacts_status_idx" ON "artifacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "artifacts_type_idx" ON "artifacts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "artifacts_created_at_idx" ON "artifacts" USING btree ("created_at");