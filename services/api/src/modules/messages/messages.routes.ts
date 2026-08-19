import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { asc, desc, eq } from "drizzle-orm";

import {
  db,
  messages,
  conversations,
} from "@ak-vision-ai/database";

import {
  CreateMessageBodySchema,
  UpdateMessageBodySchema,
} from "../../common/schemas/messages.schemas.js";

import {
  UuidParamSchema,
} from "../../common/schemas/common.schemas.js";

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

const ConversationMessagesQuerySchema = Type.Object({
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

export async function messagesRoutes(app: FastifyInstance) {
  // =========================================================
  // GET /api/v1/messages
  //
  // Examples:
  // /messages
  // /messages?limit=20
  // /messages?limit=20&offset=20
  // /messages?order=desc
  // /messages?conversationId=<uuid>
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
        querystring: MessagesListQuerySchema,
      },
    },
    async (request, reply) => {
      const {
        conversationId,
        limit = 20,
        offset = 0,
        order = "asc",
      } = request.query;

      // -------------------------------------------------------
      // Verify conversation when conversationId is supplied
      // -------------------------------------------------------

      if (conversationId) {
        const conversationResult = await db
          .select({
            id: conversations.id,
          })
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .limit(1);

        if (!conversationResult[0]) {
          return reply.code(404).send({
            status: "error",
            message: "Conversation not found",
          });
        }
      }

      // -------------------------------------------------------
      // Build query
      // -------------------------------------------------------

      const query = db
        .select()
        .from(messages);

      const result = conversationId
        ? await query
            .where(eq(messages.conversationId, conversationId))
            .orderBy(
              order === "desc"
                ? desc(messages.createdAt)
                : asc(messages.createdAt),
            )
            .limit(limit)
            .offset(offset)
        : await query
            .orderBy(
              order === "desc"
                ? desc(messages.createdAt)
                : asc(messages.createdAt),
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
          conversationId: conversationId ?? null,
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
      const { id } = request.params;

      const result = await db
        .select()
        .from(messages)
        .where(eq(messages.id, id))
        .limit(1);

      const message = result[0];

      if (!message) {
        return reply.code(404).send({
          status: "error",
          message: "Message not found",
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
  //
  // Conversation history shortcut
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
          conversationId: Type.String({
            format: "uuid",
          }),
        }),
        querystring: ConversationMessagesQuerySchema,
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

      // -------------------------------------------------------
      // Verify conversation
      // -------------------------------------------------------

      const conversationResult = await db
        .select({
          id: conversations.id,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (!conversationResult[0]) {
        return reply.code(404).send({
          status: "error",
          message: "Conversation not found",
        });
      }

      // -------------------------------------------------------
      // Fetch messages
      // -------------------------------------------------------

      const result = await db
        .select()
        .from(messages)
        .where(
          eq(
            messages.conversationId,
            conversationId,
          ),
        )
        .orderBy(asc(messages.createdAt))
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
        body: CreateMessageBodySchema,
      },
    },
    async (request, reply) => {
      const {
        conversationId,
        role = "user",
        contentType = "text",
        content,
      } = request.body;

      // -------------------------------------------------------
      // Verify conversation
      // -------------------------------------------------------

      const conversationResult = await db
        .select({
          id: conversations.id,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (!conversationResult[0]) {
        return reply.code(404).send({
          status: "error",
          message: "Conversation not found",
        });
      }

      // -------------------------------------------------------
      // Insert message
      // -------------------------------------------------------

      const result = await db
        .insert(messages)
        .values({
          conversationId,
          role,
          contentType,
          content: content.trim(),
        })
        .returning();

      return reply.code(201).send({
        status: "ok",
        data: result[0],
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
        body: UpdateMessageBodySchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // -------------------------------------------------------
      // Find existing message
      // -------------------------------------------------------

      const existingResult = await db
        .select()
        .from(messages)
        .where(eq(messages.id, id))
        .limit(1);

      const existingMessage = existingResult[0];

      if (!existingMessage) {
        return reply.code(404).send({
          status: "error",
          message: "Message not found",
        });
      }

      // -------------------------------------------------------
      // Prepare update
      // -------------------------------------------------------

      const updateData: {
        role?: MessageRole;
        contentType?: MessageContentType;
        content?: string;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if (request.body.role !== undefined) {
        updateData.role = request.body.role;
      }

      if (request.body.contentType !== undefined) {
        updateData.contentType =
          request.body.contentType;
      }

      if (request.body.content !== undefined) {
        updateData.content =
          request.body.content.trim();
      }

      // -------------------------------------------------------
      // Update
      // -------------------------------------------------------

      const result = await db
        .update(messages)
        .set(updateData)
        .where(eq(messages.id, id))
        .returning();

      return {
        status: "ok",
        data: result[0],
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
        params: UuidParamSchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const result = await db
        .delete(messages)
        .where(eq(messages.id, id))
        .returning();

      const message = result[0];

      if (!message) {
        return reply.code(404).send({
          status: "error",
          message: "Message not found",
        });
      }

      return {
        status: "ok",
        message: "Message deleted successfully",
        data: message,
      };
    },
  );
}