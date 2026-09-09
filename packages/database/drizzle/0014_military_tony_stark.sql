ALTER TABLE "artifacts" ADD COLUMN "storage_key" varchar(1000);--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_storage_key_unique" ON "artifacts" USING btree ("storage_key");