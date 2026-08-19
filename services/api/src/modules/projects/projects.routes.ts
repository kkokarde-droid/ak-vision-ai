import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  db,
  projects,
  organizations,
  organizationMemberships,
  users,
} from "@ak-vision-ai/database";

type ProjectType =
  | "general"
  | "research"
  | "coding"
  | "website"
  | "mobile-app"
  | "image"
  | "video"
  | "audio"
  | "business"
  | "erp"
  | "crm"
  | "automation";

type ProjectStatus = "active" | "archived" | "deleted";

type CreateProjectBody = {
  organizationId: string;
  ownerUserId: string;
  name: string;
  description?: string;
  type?: ProjectType;
  status?: ProjectStatus;
};

type UpdateProjectBody = {
  name?: string;
  description?: string | null;
  type?: ProjectType;
  status?: ProjectStatus;
  ownerUserId?: string;
};

export async function projectsRoutes(app: FastifyInstance) {
  // GET /api/v1/projects
  app.get("/", async () => {
    const result = await db
      .select()
      .from(projects)
      .orderBy(projects.createdAt);

    return {
      status: "ok",
      data: result,
    };
  });

  // GET /api/v1/projects/:id
  app.get<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      const result = await db
        .select()
        .from(projects)
        .where(eq(projects.id, request.params.id))
        .limit(1);

      const project = result[0];

      if (!project) {
        return reply.code(404).send({
          status: "error",
          message: "Project not found",
        });
      }

      return {
        status: "ok",
        data: project,
      };
    },
  );

  // POST /api/v1/projects
  app.post<{ Body: CreateProjectBody }>(
    "/",
    async (request, reply) => {
      const {
        organizationId,
        ownerUserId,
        name,
        description,
        type = "general",
        status = "active",
      } = request.body;

      if (!organizationId || !ownerUserId || !name) {
        return reply.code(400).send({
          status: "error",
          message: "organizationId, ownerUserId and name are required",
        });
      }

      const organizationResult = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!organizationResult[0]) {
        return reply.code(404).send({
          status: "error",
          message: "Organization not found",
        });
      }

      const userResult = await db
        .select()
        .from(users)
        .where(eq(users.id, ownerUserId))
        .limit(1);

      if (!userResult[0]) {
        return reply.code(404).send({
          status: "error",
          message: "Owner user not found",
        });
      }

      const membershipResult = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, ownerUserId),
          ),
        )
        .limit(1);

      if (!membershipResult[0]) {
        return reply.code(400).send({
          status: "error",
          message: "Owner user is not a member of this organization",
        });
      }

      const result = await db
        .insert(projects)
        .values({
          organizationId,
          ownerUserId,
          name,
          description,
          type,
          status,
        })
        .returning();

      return reply.code(201).send({
        status: "ok",
        data: result[0],
      });
    },
  );

  // PATCH /api/v1/projects/:id
  app.patch<{
    Params: { id: string };
    Body: UpdateProjectBody;
  }>(
    "/:id",
    async (request, reply) => {
      const existingResult = await db
        .select()
        .from(projects)
        .where(eq(projects.id, request.params.id))
        .limit(1);

      const existingProject = existingResult[0];

      if (!existingProject) {
        return reply.code(404).send({
          status: "error",
          message: "Project not found",
        });
      }

      const {
        name,
        description,
        type,
        status,
        ownerUserId,
      } = request.body;

      if (ownerUserId) {
        const ownerResult = await db
          .select()
          .from(users)
          .where(eq(users.id, ownerUserId))
          .limit(1);

        if (!ownerResult[0]) {
          return reply.code(404).send({
            status: "error",
            message: "Owner user not found",
          });
        }

        const membershipResult = await db
          .select()
          .from(organizationMemberships)
          .where(
            and(
              eq(
                organizationMemberships.organizationId,
                existingProject.organizationId,
              ),
              eq(organizationMemberships.userId, ownerUserId),
            ),
          )
          .limit(1);

        if (!membershipResult[0]) {
          return reply.code(400).send({
            status: "error",
            message: "Owner user is not a member of this organization",
          });
        }
      }

      const result = await db
        .update(projects)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(ownerUserId !== undefined ? { ownerUserId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, request.params.id))
        .returning();

      return {
        status: "ok",
        data: result[0],
      };
    },
  );

  // DELETE /api/v1/projects/:id
  app.delete<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      const result = await db
        .delete(projects)
        .where(eq(projects.id, request.params.id))
        .returning();

      const project = result[0];

      if (!project) {
        return reply.code(404).send({
          status: "error",
          message: "Project not found",
        });
      }

      return {
        status: "ok",
        message: "Project deleted successfully",
        data: project,
      };
    },
  );
}
