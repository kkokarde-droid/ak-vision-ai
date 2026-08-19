import type { ID, ISODateString } from "./common.js";

export type ConversationStatus =
  | "active"
  | "archived"
  | "deleted";

export type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool";

export type MessageContentType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "code"
  | "research"
  | "artifact";

export interface Conversation {
  id: ID;
  projectId: ID;
  organizationId: ID;
  title: string;
  status: ConversationStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MessageContent {
  type: MessageContentType;
  text?: string;
  url?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: ID;
  conversationId: ID;
  role: MessageRole;
  contents: MessageContent[];
  createdAt: ISODateString;
}
