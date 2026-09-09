ALTER TABLE "generation_outputs"
ADD COLUMN "idempotency_key" varchar(255);

--> statement-breakpoint

UPDATE "generation_outputs"
SET "idempotency_key" = 'legacy-' || "id"::text
WHERE "idempotency_key" IS NULL;

--> statement-breakpoint

ALTER TABLE "generation_outputs"
ALTER COLUMN "idempotency_key" SET NOT NULL;

--> statement-breakpoint

CREATE UNIQUE INDEX "generation_outputs_job_idempotency_unique"
ON "generation_outputs"
USING btree ("job_id","idempotency_key");