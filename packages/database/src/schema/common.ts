import {
  pgEnum,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "customer",
  "admin",
  "super_admin",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "pending",
  "deleted",
]);

export const accountTypeEnum = pgEnum("account_type", [
  "individual",
  "business",
  "enterprise",
]);

export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "member",
  "billing",
]);

export const projectTypeEnum = pgEnum("project_type", [
  "general",
  "research",
  "coding",
  "website",
  "mobile-app",
  "image",
  "video",
  "audio",
  "business",
  "erp",
  "crm",
  "automation",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
  "deleted",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "archived",
  "deleted",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
  "tool",
]);

export const messageContentTypeEnum = pgEnum("message_content_type", [
  "text",
  "image",
  "video",
  "audio",
  "file",
  "code",
  "research",
  "artifact",
]);

export const createdAt = timestamp("created_at", {
  withTimezone: true,
  mode: "date",
})
  .notNull()
  .defaultNow();

export const updatedAt = timestamp("updated_at", {
  withTimezone: true,
  mode: "date",
})
  .notNull()
  .defaultNow();

export const id = uuid("id").defaultRandom().primaryKey();

export const email = varchar("email", {
  length: 320,
}).notNull();
export const artifactTypeEnum = pgEnum("artifact_type", [
  "document",
  "spreadsheet",
  "presentation",
  "image",
  "video",
  "audio",
  "code",
  "website",
  "webpage",
  "mobile-app",
  "desktop-app",
  "pdf",
  "data",
  "other",
]);

export const artifactStatusEnum = pgEnum("artifact_status", [
  "draft",
  "processing",
  "ready",
  "failed",
  "archived",
]);
export const generationTypeEnum = pgEnum("generation_type", [
  "image",
  "video",
  "audio",
  "speech",
  "music",
  "document",
  "spreadsheet",
  "presentation",
]);

export const generationStatusEnum = pgEnum("generation_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const generationPriorityEnum = pgEnum(
  "generation_priority",
  [
    "low",
    "normal",
    "high",
  ],
);
