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
