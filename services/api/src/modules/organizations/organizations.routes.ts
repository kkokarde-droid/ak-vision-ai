import type { FastifyInstance } from "fastify";
import { and, eq, inArray, or } from "drizzle-orm";

import {
  db,
  organizationMemberships,
  organizations,
  users,
} from "@ak-vision-ai/database";

import { authenticate } from "../../common/auth/auth.guard.js";
import {
  getOrganizationAccess,
} from "../../common/auth/organization-access.js";
import {
  CreateOrganizationBodySchema,
  UpdateOrganizationBodySchema,
  OrganizationIdParamSchema,
} from "../../common/schemas/organizations.schemas.js";

function canManageOrganization(
  actor: NonNullable<
    Awaited<ReturnType<typeof getOrganizationAccess>>
  >,
): boolean {
  return (
    actor.role === "owner" ||
    actor.role === "admin"
  );
}

export async function organizationsRoutes(
  app: FastifyInstance,
) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request) => {
    const actor = request.auth!;

    const membershipRows = await db
      .select({
        organizationId: organizationMemberships.organizationId,
      })
      .from(organizationMemberships)
      .where(
        eq(
          organizationMemberships.userId,
          actor.userId,
        ),
      );

    const organizationIds = membershipRows.map(
      (row) => row.organizationId,
    );

    const predicates = [
      eq(
        organizations.ownerUserId,
        actor.userId,
      ),
    ];

    if (organizationIds.length > 0) {
      predicates.push(
        inArray(
          organizations.id,
          organizationIds,
        ),
      );
    }

    const result = await db
      .select()
      .from(organizations)
      .where(or(...predicates))
      .orderBy(organizations.createdAt);

    return {
      status: "ok",
      data: result,
    };
  });

  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params: OrganizationIdParamSchema,
      },
    },
    async (request, reply) => {
      const access =
        await getOrganizationAccess(
          request.auth!.userId,
          request.params.id,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Organization not found",
        });
      }

      const result = await db
        .select()
        .from(organizations)
        .where(
          eq(
            organizations.id,
            request.params.id,
          ),
        )
        .limit(1);

      const organization = result[0];

      if (!organization) {
        return reply.code(404).send({
          status: "error",
          message:
            "Organization not found",
        });
      }

      return {
        status: "ok",
        data: organization,
      };
    },
  );

  app.post<{
    Body: {
      name: string;
    };
  }>(
    "/",
    {
      schema: {
        body: CreateOrganizationBodySchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;
      const name =
        request.body.name?.trim();

      if (!name) {
        return reply.code(400).send({
          status: "error",
          message: "name is required",
        });
      }

      const result =
        await db.transaction(async (tx) => {
          const organizationResult =
            await tx
              .insert(organizations)
              .values({
                name,
                ownerUserId:
                  actor.userId,
              })
              .returning();

          const organization =
            organizationResult[0];

          if (!organization) {
            throw new Error(
              "Failed to create organization",
            );
          }

          await tx
            .insert(
              organizationMemberships,
            )
            .values({
              organizationId:
                organization.id,
              userId:
                actor.userId,
              role: "owner",
            });

          return organization;
        });

      return reply.code(201).send({
        status: "ok",
        data: result,
      });
    },
  );

  app.patch<{
    Params: {
      id: string;
    };
    Body: {
      name?: string;
      ownerUserId?: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params: OrganizationIdParamSchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;
      const {
        name,
        ownerUserId,
      } = request.body;

      if (
        name === undefined &&
        ownerUserId === undefined
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "At least one field is required: name or ownerUserId",
        });
      }

      if (
        name !== undefined &&
        !name.trim()
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "name cannot be empty",
        });
      }

      const organizationResult =
        await db
          .select()
          .from(organizations)
          .where(
            eq(
              organizations.id,
              request.params.id,
            ),
          )
          .limit(1);

      const organization =
        organizationResult[0];

      if (!organization) {
        return reply.code(404).send({
          status: "error",
          message:
            "Organization not found",
        });
      }

      const access =
        await getOrganizationAccess(
          actor.userId,
          organization.id,
        );

      if (
        !access ||
        !canManageOrganization(access)
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Organization management access denied",
        });
      }

      if (
        ownerUserId !== undefined
      ) {
        if (access.role !== "owner") {
          return reply.code(403).send({
            status: "error",
            message:
              "Only the organization owner can transfer ownership",
          });
        }

        if (
          ownerUserId !==
          organization.ownerUserId
        ) {
          const newOwnerResult =
            await db
              .select({
                id: users.id,
                status: users.status,
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
            newOwnerResult[0];

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
                "Only an active user can own an organization",
            });
          }

          const membership =
            await db
              .select({
                id:
                  organizationMemberships.id,
                role:
                  organizationMemberships.role,
              })
              .from(
                organizationMemberships,
              )
              .where(
                and(
                  eq(
                    organizationMemberships.organizationId,
                    organization.id,
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
                "New owner must already be a member of the organization",
            });
          }
        }
      }

      const result =
        await db.transaction(async (tx) => {
          if (
            ownerUserId !== undefined &&
            ownerUserId !==
              organization.ownerUserId
          ) {
            await tx
              .update(
                organizationMemberships,
              )
              .set({
                role: "admin",
                updatedAt:
                  new Date(),
              })
              .where(
                and(
                  eq(
                    organizationMemberships.organizationId,
                    organization.id,
                  ),
                  eq(
                    organizationMemberships.userId,
                    organization.ownerUserId,
                  ),
                ),
              );

            await tx
              .update(
                organizationMemberships,
              )
              .set({
                role: "owner",
                updatedAt:
                  new Date(),
              })
              .where(
                and(
                  eq(
                    organizationMemberships.organizationId,
                    organization.id,
                  ),
                  eq(
                    organizationMemberships.userId,
                    ownerUserId,
                  ),
                ),
              );
          }

          const updateData: {
            name?: string;
            ownerUserId?: string;
            updatedAt: Date;
          } = {
            updatedAt:
              new Date(),
          };

          if (name !== undefined) {
            updateData.name =
              name.trim();
          }

          if (
            ownerUserId !== undefined
          ) {
            updateData.ownerUserId =
              ownerUserId;
          }

          const updateResult =
            await tx
              .update(organizations)
              .set(updateData)
              .where(
                eq(
                  organizations.id,
                  organization.id,
                ),
              )
              .returning();

          return updateResult[0];
        });

      if (!result) {
        return reply.code(404).send({
          status: "error",
          message:
            "Organization not found",
        });
      }

      return {
        status: "ok",
        data: result,
      };
    },
  );

  app.delete<{
    Params: {
      id: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params: OrganizationIdParamSchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;

      const organizationResult =
        await db
          .select()
          .from(organizations)
          .where(
            eq(
              organizations.id,
              request.params.id,
            ),
          )
          .limit(1);

      const organization =
        organizationResult[0];

      if (!organization) {
        return reply.code(404).send({
          status: "error",
          message:
            "Organization not found",
        });
      }

      const access =
        await getOrganizationAccess(
          actor.userId,
          organization.id,
        );

      const allowed =
        actor.role === "super_admin" ||
        access?.role === "owner";

      if (!allowed) {
        return reply.code(403).send({
          status: "error",
          message:
            "Organization deletion access denied",
        });
      }

      const result = await db
        .delete(organizations)
        .where(
          eq(
            organizations.id,
            organization.id,
          ),
        )
        .returning();

      const deleted = result[0];

      if (!deleted) {
        return reply.code(404).send({
          status: "error",
          message:
            "Organization not found",
        });
      }

      return {
        status: "ok",
        message:
          "Organization deleted successfully",
        data: deleted,
      };
    },
  );
}
