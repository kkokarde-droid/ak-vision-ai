import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  db,
  organizationMemberships,
  organizations,
  users,
} from "@ak-vision-ai/database";

export async function membershipsRoutes(app: FastifyInstance) {
  // GET /api/v1/memberships
  app.get("/", async () => {
    const result = await db
      .select({
        id: organizationMemberships.id,
        organizationId: organizationMemberships.organizationId,
        userId: organizationMemberships.userId,
        role: organizationMemberships.role,
        createdAt: organizationMemberships.createdAt,
        updatedAt: organizationMemberships.updatedAt,
      })
      .from(organizationMemberships)
      .orderBy(organizationMemberships.createdAt);

    return {
      status: "ok",
      data: result,
    };
  });

  // GET /api/v1/memberships/:id
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const result = await db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.id, request.params.id))
      .limit(1);

    const membership = result[0];

    if (!membership) {
      return reply.code(404).send({
        status: "error",
        message: "Membership not found",
      });
    }

    return {
      status: "ok",
      data: membership,
    };
  });

  // POST /api/v1/memberships
  app.post<{
    Body: {
      organizationId: string;
      userId: string;
      role?: "owner" | "admin" | "member" | "billing";
    };
  }>("/", async (request, reply) => {
    const {
      organizationId,
      userId,
      role = "member",
    } = request.body;

    if (!organizationId || !userId) {
      return reply.code(400).send({
        status: "error",
        message: "organizationId and userId are required",
      });
    }

    const organization = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organization[0]) {
      return reply.code(404).send({
        status: "error",
        message: "Organization not found",
      });
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return reply.code(404).send({
        status: "error",
        message: "User not found",
      });
    }

    const existing = await db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      return reply.code(409).send({
        status: "error",
        message: "User is already a member of this organization",
      });
    }

    const result = await db
      .insert(organizationMemberships)
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
  });

  // PATCH /api/v1/memberships/:id
  app.patch<{
    Params: { id: string };
    Body: {
      role?: "owner" | "admin" | "member" | "billing";
    };
  }>("/:id", async (request, reply) => {
    const { role } = request.body;

    if (!role) {
      return reply.code(400).send({
        status: "error",
        message: "role is required",
      });
    }

    const result = await db
      .update(organizationMemberships)
      .set({
        role,
        updatedAt: new Date(),
      })
      .where(eq(organizationMemberships.id, request.params.id))
      .returning();

    const membership = result[0];

    if (!membership) {
      return reply.code(404).send({
        status: "error",
        message: "Membership not found",
      });
    }

    return {
      status: "ok",
      data: membership,
    };
  });

  // DELETE /api/v1/memberships/:id
  app.delete<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      const result = await db
        .delete(organizationMemberships)
        .where(eq(organizationMemberships.id, request.params.id))
        .returning();

      const membership = result[0];

      if (!membership) {
        return reply.code(404).send({
          status: "error",
          message: "Membership not found",
        });
      }

      return {
        status: "ok",
        message: "Membership deleted successfully",
        data: membership,
      };
    },
  );
}
