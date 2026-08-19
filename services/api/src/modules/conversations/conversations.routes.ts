import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";

import {
  db,
  conversations,
  organizationMemberships,
  projects,
  users,
} from "@ak-vision-ai/database";

type ConversationStatus = "active" | "archived" | "deleted";

export async function conversationsRoutes(app: FastifyInstance) {
  // GET /api/v1/conversations
  app.get("/", async () => {
    const result = await db
      .select()
      .from(conversations)
      .orderBy(conversations.createdAt);

    return {
      status: "ok",
      data: result,
    };
  });

  // GET /api/v1/conversations/:id
  app.get<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      const result = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, request.params.id))
        .limit(1);

      const conversation = result[0];

      if (!conversation) {
        return reply.code(404).send({
          status: "error",
          message: "Conversation not found",
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
      userId: string;
      title: string;
      status?: ConversationStatus;
    };
  }>("/", async (request, reply) => {
    const {
      projectId,
      userId,
      title,
      status = "active",
    } = request.body;

    if (!projectId || !userId || !title) {
      return reply.code(400).send({
        status: "error",
        message: "projectId, userId and title are required",
      });
    }

    // Verify project exists
    const projectResult = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const project = projectResult[0];

    if (!project) {
      return reply.code(404).send({
        status: "error",
        message: "Project not found",
      });
    }

    // Verify user exists
    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = userResult[0];

    if (!user) {
      return reply.code(404).send({
        status: "error",
        message: "User not found",
      });
    }

    // Check whether the user is the project owner
    const isProjectOwner = project.ownerUserId === userId;

    // Check organization membership
    const membershipResult = await db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(
            organizationMemberships.organizationId,
            project.organizationId,
          ),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .limit(1);

    const isOrganizationMember = Boolean(membershipResult[0]);

    if (!isProjectOwner && !isOrganizationMember) {
      return reply.code(403).send({
        status: "error",
        message: "User does not have access to this project",
      });
    }

    const result = await db
      .insert(conversations)
      .values({
        projectId,
        userId,
        title,
        status,
      })
      .returning();

    return reply.code(201).send({
      status: "ok",
      data: result[0],
    });
  });

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
    async (request, reply) => {
      const existingResult = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, request.params.id))
        .limit(1);

      const existingConversation = existingResult[0];

      if (!existingConversation) {
        return reply.code(404).send({
          status: "error",
          message: "Conversation not found",
        });
      }

      const { title, status } = request.body;

      if (title === undefined && status === undefined) {
        return reply.code(400).send({
          status: "error",
          message: "At least one field is required",
        });
      }

      const updateData: {
        title?: string;
        status?: ConversationStatus;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if (title !== undefined) {
        if (!title.trim()) {
          return reply.code(400).send({
            status: "error",
            message: "title cannot be empty",
          });
        }

        updateData.title = title;
      }

      if (status !== undefined) {
        updateData.status = status;
      }

      const result = await db
        .update(conversations)
        .set(updateData)
        .where(eq(conversations.id, request.params.id))
        .returning();

      return {
        status: "ok",
        data: result[0],
      };
    },
  );

  // DELETE /api/v1/conversations/:id
  app.delete<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      const result = await db
        .delete(conversations)
        .where(eq(conversations.id, request.params.id))
        .returning();

      const conversation = result[0];

      if (!conversation) {
        return reply.code(404).send({
          status: "error",
          message: "Conversation not found",
        });
      }

      return {
        status: "ok",
        message: "Conversation deleted successfully",
        data: conversation,
      };
    },
  );
}
