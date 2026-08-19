import {
  index,
  pgTable,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  conversationStatusEnum,
  createdAt,
  id,
  updatedAt,
} from "./common.js";

import { projects } from "./projects.js";
import { users } from "./users.js";

export const conversations = pgTable(
  "conversations",
  {
    id,

    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    title: varchar("title", {
      length: 200,
    }).notNull(),

    status: conversationStatusEnum("status")
      .notNull()
      .default("active"),

    createdAt,
    updatedAt,
  },
  (table) => [
    index("conversations_project_idx").on(table.projectId),
    index("conversations_user_idx").on(table.userId),
    index("conversations_status_idx").on(table.status),
    index("conversations_created_at_idx").on(table.createdAt),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
