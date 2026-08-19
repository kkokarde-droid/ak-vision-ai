import {
  index,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import {
  createdAt,
  id,
  messageContentTypeEnum,
  messageRoleEnum,
  updatedAt,
} from "./common.js";

import { conversations } from "./conversations.js";

export const messages = pgTable(
  "messages",
  {
    id,

    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    role: messageRoleEnum("role").notNull(),

    contentType: messageContentTypeEnum("content_type")
      .notNull()
      .default("text"),

    content: text("content").notNull(),

    createdAt,
    updatedAt,
  },
  (table) => [
    index("messages_conversation_idx").on(table.conversationId),
    index("messages_role_idx").on(table.role),
    index("messages_created_at_idx").on(table.createdAt),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
