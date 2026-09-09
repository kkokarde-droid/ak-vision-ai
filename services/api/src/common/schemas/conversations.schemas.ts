import { Type } from "@sinclair/typebox";

export const ConversationStatusSchema =
  Type.Union([
    Type.Literal("active"),
    Type.Literal("archived"),
    Type.Literal("deleted"),
  ]);

export const CreateConversationBodySchema =
  Type.Object({
    projectId: Type.String({
      format: "uuid",
    }),

    title: Type.String({
      minLength: 1,
      maxLength: 200,
    }),

    status: Type.Optional(
      ConversationStatusSchema,
    ),
  });

export const UpdateConversationBodySchema =
  Type.Object({
    title: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
      }),
    ),

    status: Type.Optional(
      ConversationStatusSchema,
    ),
  });

export const ConversationsListQuerySchema =
  Type.Object({
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        default: 20,
      }),
    ),

    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        default: 0,
      }),
    ),

    order: Type.Optional(
      Type.Union([
        Type.Literal("asc"),
        Type.Literal("desc"),
      ]),
    ),
  });
