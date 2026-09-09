import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";

import {
  db,
  organizationMemberships,
  organizations,
  projects,
  users,
} from "@ak-vision-ai/database";

import { authenticate } from "../../common/auth/auth.guard.js";
import {
  CreateProjectBodySchema,
  UpdateProjectBodySchema,
} from "../../common/schemas/projects.schemas.js";
import { UuidParamSchema } from "../../common/schemas/common.schemas.js";

import {
  canManageProject,
  getProjectAccess,
  requireProjectAccess,
  requireProjectManagement,
} from "../../common/auth/project-access.js";

import {
  getOrganizationAccess,
} from "../../common/auth/organization-access.js";

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

type ProjectStatus =
  | "active"
  | "archived"
  | "deleted";

export async function projectsRoutes(
  app: FastifyInstance,
) {
  app.addHook(
    "preHandler",
    authenticate,
  );

  // GET /api/v1/projects
  //
  // Only projects belonging to organizations the
  // authenticated user can access.
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
          projects.ownerUserId,
          actor.userId,
        ),
      );

      const result =
        await db
          .select()
          .from(projects)
          .where(
            and(...predicates),
          )
          .orderBy(
            projects.createdAt,
          );

      return {
        status: "ok",
        data: result,
      };
    },
  );

  // GET /api/v1/projects/:id
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
        await getProjectAccess(
          request.auth!.userId,
          request.params.id,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Project not found",
        });
      }

      const result =
        await db
          .select()
          .from(projects)
          .where(
            eq(
              projects.id,
              request.params.id,
            ),
          )
          .limit(1);

      const project = result[0];

      if (!project) {
        return reply.code(404).send({
          status: "error",
          message:
            "Project not found",
        });
      }

      return {
        status: "ok",
        data: project,
      };
    },
  );

  // POST /api/v1/projects
  app.post<{
    Body: {
      organizationId: string;
      name: string;
      description?: string;
      type?: ProjectType;
      status?: ProjectStatus;
    };
  }>(
    "/",
    async (request, reply) => {
      const actor = request.auth!;

      const {
        organizationId,
        name,
        description,
        type = "general",
        status = "active",
      } = request.body;

      const normalizedName =
        name?.trim();

      if (
        !organizationId ||
        !normalizedName
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "organizationId and name are required",
        });
      }

      const organization =
        await getOrganizationAccess(
          actor.userId,
          organizationId,
        );

      if (!organization) {
        return reply.code(403).send({
          status: "error",
          message:
            "Organization access denied",
        });
      }

      const organizationResult =
        await db
          .select({
            id:
              organizations.id,
          })
          .from(organizations)
          .where(
            eq(
              organizations.id,
              organizationId,
            ),
          )
          .limit(1);

      if (!organizationResult[0]) {
        return reply.code(404).send({
          status: "error",
          message:
            "Organization not found",
        });
      }

      const result =
        await db
          .insert(projects)
          .values({
            organizationId,
            ownerUserId:
              actor.userId,
            name:
              normalizedName,
            description,
            type,
            status,
          })
          .returning();

      const project = result[0];

      if (!project) {
        return reply.code(500).send({
          status: "error",
          message:
            "Failed to create project",
        });
      }

      return reply.code(201).send({
        status: "ok",
        data: project,
      });
    },
  );

  // PATCH /api/v1/projects/:id
  app.patch<{
    Params: {
      id: string;
    };
    Body: {
      name?: string;
      description?: string | null;
      type?: ProjectType;
      status?: ProjectStatus;
      ownerUserId?: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params: UuidParamSchema,
        body: UpdateProjectBodySchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;

      const access =
        await getProjectAccess(
          actor.userId,
          request.params.id,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Project not found",
        });
      }

      if (
        !canManageProject(access)
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Project management access denied",
        });
      }

      const {
        name,
        description,
        type,
        status,
        ownerUserId,
      } = request.body;

      if (
        name === undefined &&
        description === undefined &&
        type === undefined &&
        status === undefined &&
        ownerUserId === undefined
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "At least one field is required",
        });
      }

      const existingResult =
        await db
          .select()
          .from(projects)
          .where(
            eq(
              projects.id,
              request.params.id,
            ),
          )
          .limit(1);

      const existingProject =
        existingResult[0];

      if (!existingProject) {
        return reply.code(404).send({
          status: "error",
          message:
            "Project not found",
        });
      }

      if (
        ownerUserId !== undefined
      ) {
        if (
          access.organization.role !==
            "owner" &&
          access.organization.role !==
            "admin"
        ) {
          return reply.code(403).send({
            status: "error",
            message:
              "Only organization owner or admin can transfer project ownership",
          });
        }

        const ownerResult =
          await db
            .select({
              id:
                users.id,
              status:
                users.status,
            })
            .from(users)
            .where(
              eq(
                users.id,
                ownerUserId,
              ),
            )
            .limit(1);

        const newOwner =
          ownerResult[0];

        if (!newOwner) {
          return reply.code(404).send({
            status: "error",
            message:
              "Owner user not found",
          });
        }

        if (
          newOwner.status !==
          "active"
        ) {
          return reply.code(400).send({
            status: "error",
            message:
              "Only an active user can own a project",
          });
        }

        const membership =
          await db
            .select({
              id:
                organizationMemberships.id,
            })
            .from(
              organizationMemberships,
            )
            .where(
              and(
                eq(
                  organizationMemberships.organizationId,
                  existingProject.organizationId,
                ),
                eq(
                  organizationMemberships.userId,
                  ownerUserId,
                ),
              ),
            )
            .limit(1);

        if (!membership[0]) {
          return reply.code(400).send({
            status: "error",
            message:
              "Project owner must be a member of the project organization",
          });
        }
      }

      if (
        status === "deleted" &&
        access.organization.role !==
          "owner" &&
        access.organization.role !==
          "admin" &&
        !access.isProjectOwner
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Only a project manager can delete a project",
        });
      }

      const updateData: {
        name?: string;
        description?: string | null;
        type?: ProjectType;
        status?: ProjectStatus;
        ownerUserId?: string;
        updatedAt: Date;
      } = {
        updatedAt:
          new Date(),
      };

      if (
        name !== undefined
      ) {
        const normalizedName =
          name.trim();

        if (!normalizedName) {
          return reply.code(400).send({
            status: "error",
            message:
              "name cannot be empty",
          });
        }

        updateData.name =
          normalizedName;
      }

      if (
        description !== undefined
      ) {
        updateData.description =
          description;
      }

      if (
        type !== undefined
      ) {
        updateData.type =
          type;
      }

      if (
        status !== undefined
      ) {
        updateData.status =
          status;
      }

      if (
        ownerUserId !== undefined
      ) {
        updateData.ownerUserId =
          ownerUserId;
      }

      const result =
        await db
          .update(projects)
          .set(updateData)
          .where(
            eq(
              projects.id,
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
            "Project not found",
        });
      }

      return {
        status: "ok",
        data: updated,
      };
    },
  );

  // DELETE /api/v1/projects/:id
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
        await getProjectAccess(
          actor.userId,
          request.params.id,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Project not found",
        });
      }

      const allowed =
        actor.role ===
          "super_admin" ||
        access.organization.role ===
          "owner" ||
        access.organization.role ===
          "admin" ||
        access.isProjectOwner;

      if (!allowed) {
        return reply.code(403).send({
          status: "error",
          message:
            "Project deletion access denied",
        });
      }

      const result =
        await db
          .delete(projects)
          .where(
            eq(
              projects.id,
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
            "Project not found",
        });
      }

      return {
        status: "ok",
        message:
          "Project deleted successfully",
        data: deleted,
      };
    },
  );
}
