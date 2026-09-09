import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";

import {
  db,
  organizationMemberships,
  organizations,
  users,
} from "@ak-vision-ai/database";

import { authenticate } from "../../common/auth/auth.guard.js";
import {
  CreateMembershipBodySchema,
  MembershipIdParamSchema,
  UpdateMembershipBodySchema,
} from "../../common/schemas/memberships.schemas.js";
import {
  getOrganizationAccess,
} from "../../common/auth/organization-access.js";

type MembershipRole =
  | "owner"
  | "admin"
  | "member"
  | "billing";

function canManageMemberships(
  role: MembershipRole,
): boolean {
  return (
    role === "owner" ||
    role === "admin"
  );
}

function canAssignRole(
  actorRole: MembershipRole,
  targetRole: MembershipRole,
): boolean {
  if (actorRole === "owner") {
    return true;
  }

  return (
    actorRole === "admin" &&
    (
      targetRole === "member" ||
      targetRole === "billing"
    )
  );
}

export async function membershipsRoutes(
  app: FastifyInstance,
) {
  app.addHook(
    "preHandler",
    authenticate,
  );

  app.get<{
    Querystring: {
      organizationId?: string;
    };
  }>(
    "/",
    async (request, reply) => {
      const actor = request.auth!;
      const { organizationId } =
        request.query;

      if (organizationId) {
        const access =
          await getOrganizationAccess(
            actor.userId,
            organizationId,
          );

        if (!access) {
          return reply.code(404).send({
            status: "error",
            message:
              "Organization not found",
          });
        }

        const result = await db
          .select({
            id:
              organizationMemberships.id,
            organizationId:
              organizationMemberships.organizationId,
            userId:
              organizationMemberships.userId,
            role:
              organizationMemberships.role,
            createdAt:
              organizationMemberships.createdAt,
            updatedAt:
              organizationMemberships.updatedAt,
          })
          .from(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.organizationId,
              organizationId,
            ),
          )
          .orderBy(
            organizationMemberships.createdAt,
          );

        return {
          status: "ok",
          data: result,
        };
      }

      const result = await db
        .select({
          id:
            organizationMemberships.id,
          organizationId:
            organizationMemberships.organizationId,
          userId:
            organizationMemberships.userId,
          role:
            organizationMemberships.role,
          createdAt:
            organizationMemberships.createdAt,
          updatedAt:
            organizationMemberships.updatedAt,
        })
        .from(
          organizationMemberships,
        )
        .where(
          eq(
            organizationMemberships.userId,
            actor.userId,
          ),
        )
        .orderBy(
          organizationMemberships.createdAt,
        );

      return {
        status: "ok",
        data: result,
      };
    },
  );

  // GET /api/v1/memberships/:id
  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params: MembershipIdParamSchema,
      },
    },
    async (request, reply) => {
      const result = await db
        .select()
        .from(
          organizationMemberships,
        )
        .where(
          eq(
            organizationMemberships.id,
            request.params.id,
          ),
        )
        .limit(1);

      const membership = result[0];

      if (!membership) {
        return reply.code(404).send({
          status: "error",
          message:
            "Membership not found",
        });
      }

      const access =
        await getOrganizationAccess(
          request.auth!.userId,
          membership.organizationId,
        );

      if (!access) {
        return reply.code(404).send({
          status: "error",
          message:
            "Membership not found",
        });
      }

      return {
        status: "ok",
        data: membership,
      };
    },
  );

  // POST /api/v1/memberships
  app.post<{
    Body: {
      organizationId: string;
      userId: string;
      role?: MembershipRole;
    };
  }>(
    "/",
    {
      schema: {
        body: CreateMembershipBodySchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;

      const {
        organizationId,
        userId,
        role = "member",
      } = request.body;

      if (
        !organizationId ||
        !userId
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "organizationId and userId are required",
        });
      }

      const access =
        await getOrganizationAccess(
          actor.userId,
          organizationId,
        );

      if (
        !access ||
        !canManageMemberships(
          access.role,
        )
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Membership management access denied",
        });
      }

      if (
        role === "owner" &&
        access.role !== "owner"
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Only the organization owner can assign the owner role",
        });
      }

      if (
        !canAssignRole(
          access.role,
          role,
        )
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "You cannot assign this membership role",
        });
      }

      const organization =
        await db
          .select({
            id:
              organizations.id,
            ownerUserId:
              organizations.ownerUserId,
          })
          .from(organizations)
          .where(
            eq(
              organizations.id,
              organizationId,
            ),
          )
          .limit(1);

      if (!organization[0]) {
        return reply.code(404).send({
          status: "error",
          message:
            "Organization not found",
        });
      }

      const user =
        await db
          .select({
            id: users.id,
            status: users.status,
          })
          .from(users)
          .where(
            eq(
              users.id,
              userId,
            ),
          )
          .limit(1);

      const targetUser = user[0];

      if (!targetUser) {
        return reply.code(404).send({
          status: "error",
          message:
            "User not found",
        });
      }

      if (
        targetUser.status !==
        "active"
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "Only an active user can be added to an organization",
        });
      }

      if (
        role === "owner" &&
        organization[0]
          .ownerUserId !== userId
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "Use organization ownership transfer instead of creating a second owner",
        });
      }

      const existing =
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
                organizationId,
              ),
              eq(
                organizationMemberships.userId,
                userId,
              ),
            ),
          )
          .limit(1);

      if (existing[0]) {
        return reply.code(409).send({
          status: "error",
          message:
            "User is already a member of this organization",
        });
      }

      const result =
        await db
          .insert(
            organizationMemberships,
          )
          .values({
            organizationId,
            userId,
            role,
          })
          .returning();

      return reply.code(201).send({
        status: "ok",
        data: result[0],
      });
    },
  );

  // PATCH /api/v1/memberships/:id
  app.patch<{
    Params: {
      id: string;
    };
    Body: {
      role: MembershipRole;
    };
  }>(
    "/:id",
    {
      schema: {
        params: MembershipIdParamSchema,
        body: UpdateMembershipBodySchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;
      const { role } =
        request.body;

      if (!role) {
        return reply.code(400).send({
          status: "error",
          message:
            "role is required",
        });
      }

      const membershipResult =
        await db
          .select()
          .from(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.id,
              request.params.id,
            ),
          )
          .limit(1);

      const membership =
        membershipResult[0];

      if (!membership) {
        return reply.code(404).send({
          status: "error",
          message:
            "Membership not found",
        });
      }

      const access =
        await getOrganizationAccess(
          actor.userId,
          membership.organizationId,
        );

      if (
        !access ||
        !canManageMemberships(
          access.role,
        )
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Membership management access denied",
        });
      }

      const organizationResult =
        await db
          .select({
            ownerUserId:
              organizations.ownerUserId,
          })
          .from(organizations)
          .where(
            eq(
              organizations.id,
              membership.organizationId,
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

      if (
        membership.userId ===
        organization.ownerUserId
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Organization owner membership cannot be changed here",
        });
      }

      if (
        role === "owner"
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Use organization ownership transfer to assign owner role",
        });
      }

      if (
        !canAssignRole(
          access.role,
          role,
        )
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "You cannot assign this membership role",
        });
      }

      const result =
        await db
          .update(
            organizationMemberships,
          )
          .set({
            role,
            updatedAt:
              new Date(),
          })
          .where(
            eq(
              organizationMemberships.id,
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
            "Membership not found",
        });
      }

      return {
        status: "ok",
        data: updated,
      };
    },
  );

  // DELETE /api/v1/memberships/:id
  app.delete<{
    Params: {
      id: string;
    };
  }>(
    "/:id",
    {
      schema: {
        params: MembershipIdParamSchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;

      const membershipResult =
        await db
          .select()
          .from(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.id,
              request.params.id,
            ),
          )
          .limit(1);

      const membership =
        membershipResult[0];

      if (!membership) {
        return reply.code(404).send({
          status: "error",
          message:
            "Membership not found",
        });
      }

      const access =
        await getOrganizationAccess(
          actor.userId,
          membership.organizationId,
        );

      if (
        !access ||
        !canManageMemberships(
          access.role,
        )
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Membership management access denied",
        });
      }

      const organizationResult =
        await db
          .select({
            ownerUserId:
              organizations.ownerUserId,
          })
          .from(organizations)
          .where(
            eq(
              organizations.id,
              membership.organizationId,
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

      if (
        membership.userId ===
        organization.ownerUserId
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Organization owner cannot be removed from membership",
        });
      }

      if (
        membership.role ===
          "admin" &&
        access.role !== "owner"
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Only the organization owner can remove an admin",
        });
      }

      const result =
        await db
          .delete(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.id,
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
            "Membership not found",
        });
      }

      return {
        status: "ok",
        message:
          "Membership deleted successfully",
        data: deleted,
      };
    },
  );
}
