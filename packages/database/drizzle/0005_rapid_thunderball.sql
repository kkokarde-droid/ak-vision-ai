CREATE TYPE "public"."generation_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."generation_type" AS ENUM('image', 'video', 'audio', 'speech', 'music', 'document', 'spreadsheet', 'presentation');--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"project_id" uuid,
	"conversation_id" uuid,
	"credit_reservation_id" uuid NOT NULL,
	"type" "generation_type" NOT NULL,
	"status" "generation_status" DEFAULT 'queued' NOT NULL,
	"priority" "generation_priority" DEFAULT 'normal' NOT NULL,
	"provider_id" varchar(100),
	"provider_model_id" varchar(150),
	"progress" integer DEFAULT 0 NOT NULL,
	"prompt" varchar(10000),
	"input" jsonb,
	"output" jsonb,
	"error_code" varchar(100),
	"error_message" varchar(2000),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(255),
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_progress_valid" CHECK ("generation_jobs"."progress" >= 0 AND "generation_jobs"."progress" <= 100),
	CONSTRAINT "generation_jobs_attempt_count_valid" CHECK ("generation_jobs"."attempt_count" >= 0),
	CONSTRAINT "generation_jobs_max_attempts_valid" CHECK ("generation_jobs"."max_attempts" > 0),
	CONSTRAINT "generation_jobs_processing_lease_valid" CHECK ((
        "generation_jobs"."status" <> 'processing'
        OR "generation_jobs"."lease_expires_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "generation_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"type" "generation_type" NOT NULL,
	"url" varchar(4000) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_outputs_size_nonnegative" CHECK ("generation_outputs"."size_bytes" IS NULL OR "generation_outputs"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_credit_reservation_id_credit_reservations_id_fk" FOREIGN KEY ("credit_reservation_id") REFERENCES "public"."credit_reservations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "generation_outputs" ADD CONSTRAINT "generation_outputs_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_request_unique" ON "generation_jobs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_reservation_unique" ON "generation_jobs" USING btree ("credit_reservation_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_user_idx" ON "generation_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_organization_idx" ON "generation_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_project_idx" ON "generation_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_conversation_idx" ON "generation_jobs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generation_jobs_priority_idx" ON "generation_jobs" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "generation_jobs_next_attempt_idx" ON "generation_jobs" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_lease_idx" ON "generation_jobs" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_created_at_idx" ON "generation_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "generation_outputs_job_idx" ON "generation_outputs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "generation_outputs_type_idx" ON "generation_outputs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "generation_outputs_created_at_idx" ON "generation_outputs" USING btree ("created_at");