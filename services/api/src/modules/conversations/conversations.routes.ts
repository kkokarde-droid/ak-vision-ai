import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";

import {
  db,
  conversations,
  organizationMemberships,
  projects,
} from "@ak-vision-ai/database";

import { authenticate } from "../../common/auth/auth.guard.js";

import {
  CreateConversationBodySchema,
  UpdateConversationBodySchema,
} from "../../common/schemas/conversations.schemas.js";
import { UuidParamSchema } from "../../common/schemas/common.schemas.js";

import {
  getConversationAccess,
  canManageConversation,
} from "../../common/auth/conversation-access.js";

import {
  getProjectAccess,
} from "../../common/auth/project-access.js";

type ConversationStatus =
  | "active"
  | "archived"
  | "deleted";

export async function conversationsRoutes(
  app: FastifyInstance,
) {
  app.addHook(
    "preHandler",
    authenticate,
  );

  // GET /api/v1/conversations
  app.get(
    "/",
    async (request) => {
      const actor = request.auth!;

      const memberships =
        await db
          .select({
            organizationId:
              organizationMemberships.organizationId,
          })
          .from(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.userId,
              actor.userId,
            ),
          );

      const organizationIds =
        memberships.map(
          (row) =>
            row.organizationId,
        );

      const predicates = [];

      if (
        organizationIds.length > 0
      ) {
        predicates.push(
          inArray(
            projects.organizationId,
            organizationIds,
          ),
        );
      }

      predicates.push(
        eq(
          conversations.userId,
          actor.userId,
        ),
      );

      const result =
        await db
          .select({
            id: conversations.id,
            projectId:
              conversations.projectId,
            userId:
              conversations.userId,
            title:
              conversations.title,
            status:
              conversations.status,
            createdAt:
              conversations.createdAt,
            updatedAt:
              conversations.updatedAt,
          })
          .from(conversations)
          .innerJoin(
            projects,
            eq(
              projects.id,
              conversations.projectId,
            ),
          )
          .where(
            and(...predicates),
          )
          .orderBy(
            conversations.createdAt,
          );

      return {
        status: "ok",
        data: result,
      };
    },
  );

  // GET /api/v1/conversations/:id
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
      const access =
        await getConversationAccess(
          request.auth!.userId,
          request.params.id,
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
          .from(conversations)
          .where(
            eq(
              conversations.id,
              request.params.id,
            ),
          )
          .limit(1);

      const conversation =
        result[0];

      if (!conversation) {
        return reply.code(404).send({
          status: "error",
          message:
            "Conversation not found",
        });
      }

      return {
        status: "ok",
        data: conversation,
      };
    },
  );

  // POST /api/v1/conversations
  app.post<{
    Body: {
      projectId: string;
      title: string;
      status?: ConversationStatus;
    };
  }>(
    "/",
    {
      schema: {
        body: CreateConversationBodySchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;

      const {
        projectId,
        title,
        status = "active",
      } = request.body;

      const normalizedTitle =
        title?.trim();

      if (
        !projectId ||
        !normalizedTitle
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "projectId and title are required",
        });
      }

      const project =
        await getProjectAccess(
          actor.userId,
          projectId,
        );

      if (!project) {
        return reply.code(404).send({
          status: "error",
          message:
            "Project not found",
        });
      }

      const result =
        await db
          .insert(conversations)
          .values({
            projectId,
            userId:
              actor.userId,
            title:
              normalizedTitle,
            status,
          })
          .returning();

      const conversation =
        result[0];

      if (!conversation) {
        return reply.code(500).send({
          status: "error",
          message:
            "Failed to create conversation",
        });
      }

      return reply.code(201).send({
        status: "ok",
        data: conversation,
      });
    },
  );

  // PATCH /api/v1/conversations/:id
  app.patch<{
    Params: {
      id: string;
    };
    Body: {
      title?: string;
      status?: ConversationStatus;
    };
  }>(
    "/:id",
    {
      schema: {
        params: UuidParamSchema,
        body: UpdateConversationBodySchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;

      const access =
        await getConversationAccess(
          actor.userId,
          request.params.id,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Conversation not found",
        });
      }

      if (
        !canManageConversation(access)
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Conversation management access denied",
        });
      }

      const {
        title,
        status,
      } = request.body;

      if (
        title === undefined &&
        status === undefined
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "At least one field is required",
        });
      }

      const updateData: {
        title?: string;
        status?: ConversationStatus;
        updatedAt: Date;
      } = {
        updatedAt:
          new Date(),
      };

      if (
        title !== undefined
      ) {
        const normalizedTitle =
          title.trim();

        if (!normalizedTitle) {
          return reply.code(400).send({
            status: "error",
            message:
              "title cannot be empty",
          });
        }

        updateData.title =
          normalizedTitle;
      }

      if (
        status !== undefined
      ) {
        updateData.status =
          status;
      }

      const result =
        await db
          .update(conversations)
          .set(updateData)
          .where(
            eq(
              conversations.id,
              request.params.id,
            ),
          )
          .returning();

      const updated =
        result[0];

      if (!updated) {
        return reply.code(404).send({
          status: "error",
          message:
            "Conversation not found",
        });
      }

      return {
        status: "ok",
        data: updated,
      };
    },
  );

  // DELETE /api/v1/conversations/:id
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
      const actor = request.auth!;

      const access =
        await getConversationAccess(
          actor.userId,
          request.params.id,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Conversation not found",
        });
      }

      const allowed =
        actor.role ===
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
            "Conversation deletion access denied",
        });
      }

      const result =
        await db
          .delete(conversations)
          .where(
            eq(
              conversations.id,
              request.params.id,
            ),
          )
          .returning();

      const deleted =
        result[0];

      if (!deleted) {
        return reply.code(404).send({
          status: "error",
          message:
            "Conversation not found",
        });
      }

      return {
        status: "ok",
        message:
          "Conversation deleted successfully",
        data: deleted,
      };
    },
  );
}
