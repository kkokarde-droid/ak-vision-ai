import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { asc, desc, eq, inArray } from "drizzle-orm";

import {
  db,
  messages,
  conversations,
  projects,
  organizationMemberships,
} from "@ak-vision-ai/database";

import {
  CreateMessageBodySchema,
  UpdateMessageBodySchema,
} from "../../common/schemas/messages.schemas.js";

import {
  UuidParamSchema,
} from "../../common/schemas/common.schemas.js";

import { authenticate } from "../../common/auth/auth.guard.js";

import {
  getConversationAccess,
  canManageConversation,
} from "../../common/auth/conversation-access.js";

type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool";

type MessageContentType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "code"
  | "research"
  | "artifact";

const MessagesListQuerySchema = Type.Object({
  conversationId: Type.Optional(
    Type.String({
      format: "uuid",
    }),
  ),

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

const ConversationMessagesQuerySchema =
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
  });

export async function messagesRoutes(
  app: FastifyInstance,
) {
  app.addHook(
    "preHandler",
    authenticate,
  );

  // =========================================================
  // GET /api/v1/messages
  //
  // A global message listing is intentionally not exposed.
  // Without conversationId, only messages belonging to
  // conversations owned by the authenticated user are returned.
  // =========================================================

  app.get<{
    Querystring: {
      conversationId?: string;
      limit?: number;
      offset?: number;
      order?: "asc" | "desc";
    };
  }>(
    "/",
    {
      schema: {
        querystring:
          MessagesListQuerySchema,
      },
    },
    async (request, reply) => {
      const {
        conversationId,
        limit = 20,
        offset = 0,
        order = "asc",
      } = request.query;

      const actor =
        request.auth!;

      if (conversationId) {
        const access =
          await getConversationAccess(
            actor.userId,
            conversationId,
          );

        if (!access) {
          return reply.code(404).send({
            status: "error",
            message:
              "Conversation not found",
          });
        }

        const result =
          await db
            .select()
            .from(messages)
            .where(
              eq(
                messages.conversationId,
                conversationId,
              ),
            )
            .orderBy(
              order === "desc"
                ? desc(
                    messages.createdAt,
                  )
                : asc(
                    messages.createdAt,
                  ),
            )
            .limit(limit)
            .offset(offset);

        return {
          status: "ok",
          data: result,
          meta: {
            limit,
            offset,
            order,
            conversationId,
            count: result.length,
          },
        };
      }

      const result =
        await db
          .select({
            id: messages.id,
            conversationId:
              messages.conversationId,
            role:
              messages.role,
            contentType:
              messages.contentType,
            content:
              messages.content,
            createdAt:
              messages.createdAt,
            updatedAt:
              messages.updatedAt,
          })
          .from(messages)
          .innerJoin(
            conversations,
            eq(
              conversations.id,
              messages.conversationId,
            ),
          )
          .where(
            eq(
              conversations.userId,
              actor.userId,
            ),
          )
          .orderBy(
            order === "desc"
              ? desc(
                  messages.createdAt,
                )
              : asc(
                  messages.createdAt,
                ),
          )
          .limit(limit)
          .offset(offset);

      return {
        status: "ok",
        data: result,
        meta: {
          limit,
          offset,
          order,
          conversationId: null,
          count: result.length,
        },
      };
    },
  );

  // =========================================================
  // GET /api/v1/messages/:id
  // =========================================================

  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params: UuidParamSchema,
      },
    },
    async (request, reply) => {
      const result =
        await db
          .select()
          .from(messages)
          .where(
            eq(
              messages.id,
              request.params.id,
            ),
          )
          .limit(1);

      const message = result[0];

      if (!message) {
        return reply.code(404).send({
          status: "error",
          message:
            "Message not found",
        });
      }

      const access =
        await getConversationAccess(
          request.auth!.userId,
          message.conversationId,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Message not found",
        });
      }

      return {
        status: "ok",
        data: message,
      };
    },
  );

  // =========================================================
  // GET /api/v1/messages/conversation/:conversationId
  // =========================================================

  app.get<{
    Params: {
      conversationId: string;
    };
    Querystring: {
      limit?: number;
      offset?: number;
    };
  }>(
    "/conversation/:conversationId",
    {
      schema: {
        params: Type.Object({
          conversationId:
            Type.String({
              format: "uuid",
            }),
        }),
        querystring:
          ConversationMessagesQuerySchema,
      },
    },
    async (request, reply) => {
      const {
        conversationId,
      } = request.params;

      const {
        limit = 20,
        offset = 0,
      } = request.query;

      const access =
        await getConversationAccess(
          request.auth!.userId,
          conversationId,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Conversation not found",
        });
      }

      const result =
        await db
          .select()
          .from(messages)
          .where(
            eq(
              messages.conversationId,
              conversationId,
            ),
          )
          .orderBy(
            asc(messages.createdAt),
          )
          .limit(limit)
          .offset(offset);

      return {
        status: "ok",
        data: result,
        meta: {
          conversationId,
          limit,
          offset,
          count: result.length,
        },
      };
    },
  );

  // =========================================================
  // POST /api/v1/messages
  // =========================================================

  app.post<{
    Body: {
      conversationId: string;
      role?: MessageRole;
      contentType?: MessageContentType;
      content: string;
    };
  }>(
    "/",
    {
      schema: {
        body:
          CreateMessageBodySchema,
      },
    },
    async (request, reply) => {
      const {
        conversationId,
        role = "user",
        contentType = "text",
        content,
      } = request.body;

      const access =
        await getConversationAccess(
          request.auth!.userId,
          conversationId,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Conversation not found",
        });
      }

      const normalizedContent =
        content.trim();

      if (!normalizedContent) {
        return reply.code(400).send({
          status: "error",
          message:
            "content cannot be empty",
        });
      }

      // Customer-originated requests may only create user
      // messages. System/tool/assistant messages should be
      // generated by trusted backend workflows.
      if (
        role !== "user" &&
        request.auth!.role ===
          "customer"
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Customer clients cannot create non-user messages",
        });
      }

      const result =
        await db
          .insert(messages)
          .values({
            conversationId,
            role,
            contentType,
            content:
              normalizedContent,
          })
          .returning();

      const message = result[0];

      if (!message) {
        return reply.code(500).send({
          status: "error",
          message:
            "Failed to create message",
        });
      }

      return reply.code(201).send({
        status: "ok",
        data: message,
      });
    },
  );

  // =========================================================
  // PATCH /api/v1/messages/:id
  // =========================================================

  app.patch<{
    Params: {
      id: string;
    };
    Body: {
      role?: MessageRole;
      contentType?: MessageContentType;
      content?: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params: UuidParamSchema,
        body:
          UpdateMessageBodySchema,
      },
    },
    async (request, reply) => {
      const { id } =
        request.params;

      const existingResult =
        await db
          .select()
          .from(messages)
          .where(
            eq(
              messages.id,
              id,
            ),
          )
          .limit(1);

      const existingMessage =
        existingResult[0];

      if (!existingMessage) {
        return reply.code(404).send({
          status: "error",
          message:
            "Message not found",
        });
      }

      const access =
        await getConversationAccess(
          request.auth!.userId,
          existingMessage.conversationId,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Message not found",
        });
      }

      if (
        !canManageConversation(
          access,
        )
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Message management access denied",
        });
      }

      const updateData: {
        role?: MessageRole;
        contentType?: MessageContentType;
        content?: string;
        updatedAt: Date;
      } = {
        updatedAt:
          new Date(),
      };

      if (
        request.body.role !==
        undefined
      ) {
        updateData.role =
          request.body.role;
      }

      if (
        request.body.contentType !==
        undefined
      ) {
        updateData.contentType =
          request.body.contentType;
      }

      if (
        request.body.content !==
        undefined
      ) {
        const content =
          request.body.content.trim();

        if (!content) {
          return reply.code(400).send({
            status: "error",
            message:
              "content cannot be empty",
          });
        }

        updateData.content =
          content;
      }

      const result =
        await db
          .update(messages)
          .set(updateData)
          .where(
            eq(
              messages.id,
              id,
            ),
          )
          .returning();

      const updated =
        result[0];

      if (!updated) {
        return reply.code(404).send({
          status: "error",
          message:
            "Message not found",
        });
      }

      return {
        status: "ok",
        data: updated,
      };
    },
  );

  // =========================================================
  // DELETE /api/v1/messages/:id
  // =========================================================

  app.delete<{
    Params: {
      id: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params:
          UuidParamSchema,
      },
    },
    async (request, reply) => {
      const { id } =
        request.params;

      const existingResult =
        await db
          .select()
          .from(messages)
          .where(
            eq(
              messages.id,
              id,
            ),
          )
          .limit(1);

      const existingMessage =
        existingResult[0];

      if (!existingMessage) {
        return reply.code(404).send({
          status: "error",
          message:
            "Message not found",
        });
      }

      const access =
        await getConversationAccess(
          request.auth!.userId,
          existingMessage.conversationId,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Message not found",
        });
      }

      const allowed =
        request.auth!.role ===
          "super_admin" ||
        access.project.organization.role ===
          "owner" ||
        access.project.organization.role ===
          "admin" ||
        access.project.isProjectOwner ||
        access.isConversationOwner;

      if (!allowed) {
        return reply.code(403).send({
          status: "error",
          message:
            "Message deletion access denied",
        });
      }

      const result =
        await db
          .delete(messages)
          .where(
            eq(
              messages.id,
              id,
            ),
          )
          .returning();

      const deleted =
        result[0];

      if (!deleted) {
        return reply.code(404).send({
          status: "error",
          message:
            "Message not found",
        });
      }

      return {
        status: "ok",
        message:
          "Message deleted successfully",
        data: deleted,
      };
    },
  );
}
