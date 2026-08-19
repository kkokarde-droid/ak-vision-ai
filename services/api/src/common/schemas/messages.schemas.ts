import { Type } from "@sinclair/typebox";

export const MessageRoleSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("assistant"),
  Type.Literal("system"),
  Type.Literal("tool"),
]);

export const MessageContentTypeSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("image"),
  Type.Literal("video"),
  Type.Literal("audio"),
  Type.Literal("file"),
  Type.Literal("code"),
  Type.Literal("research"),
  Type.Literal("artifact"),
]);

export const CreateMessageBodySchema = Type.Object({
  conversationId: Type.String({
    format: "uuid",
  }),

  role: Type.Optional(MessageRoleSchema),

  contentType: Type.Optional(MessageContentTypeSchema),

  content: Type.String({
    minLength: 1,
    maxLength: 100000,
  }),
});

export const UpdateMessageBodySchema = Type.Object({
  role: Type.Optional(MessageRoleSchema),

  contentType: Type.Optional(MessageContentTypeSchema),

  content: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 100000,
    }),
  ),
});