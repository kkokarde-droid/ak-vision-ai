import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  db,
  organizations,
  users,
} from "@ak-vision-ai/database";

export async function organizationsRoutes(app: FastifyInstance) {
  // GET /api/v1/organizations
  app.get("/", async () => {
    const result = await db
      .select()
      .from(organizations)
      .orderBy(organizations.createdAt);

    return {
      status: "ok",
      data: result,
    };
  });

  // GET /api/v1/organizations/:id
  app.get<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      const result = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, request.params.id))
        .limit(1);

      const organization = result[0];

      if (!organization) {
        return reply.code(404).send({
          status: "error",
          message: "Organization not found",
        });
      }

      return {
        status: "ok",
        data: organization,
      };
    },
  );

  // POST /api/v1/organizations
  app.post<{
    Body: {
      name: string;
      ownerUserId: string;
    };
  }>(
    "/",
    async (request, reply) => {
      const { name, ownerUserId } = request.body;

      if (!name || !ownerUserId) {
        return reply.code(400).send({
          status: "error",
          message: "name and ownerUserId are required",
        });
      }

      // Verify owner user exists
      const ownerResult = await db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, ownerUserId))
        .limit(1);

      const owner = ownerResult[0];

      if (!owner) {
        return reply.code(400).send({
          status: "error",
          message: "Owner user not found",
        });
      }

      if (owner.status === "deleted") {
        return reply.code(400).send({
          status: "error",
          message: "Deleted user cannot own an organization",
        });
      }

      const result = await db
        .insert(organizations)
        .values({
          name,
          ownerUserId,
        })
        .returning();

      return reply.code(201).send({
        status: "ok",
        data: result[0],
      });
    },
  );

  // PATCH /api/v1/organizations/:id
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
    async (request, reply) => {
      const { name, ownerUserId } = request.body;

      if (name === undefined && ownerUserId === undefined) {
        return reply.code(400).send({
          status: "error",
          message: "At least one field is required: name or ownerUserId",
        });
      }

      if (name !== undefined && name.trim().length === 0) {
        return reply.code(400).send({
          status: "error",
          message: "name cannot be empty",
        });
      }

      if (ownerUserId !== undefined) {
        const ownerResult = await db
          .select({
            id: users.id,
            status: users.status,
          })
          .from(users)
          .where(eq(users.id, ownerUserId))
          .limit(1);

        const owner = ownerResult[0];

        if (!owner) {
          return reply.code(400).send({
            status: "error",
            message: "Owner user not found",
          });
        }

        if (owner.status === "deleted") {
          return reply.code(400).send({
            status: "error",
            message: "Deleted user cannot own an organization",
          });
        }
      }

      const updateData: {
        name?: string;
        ownerUserId?: string;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if (name !== undefined) {
        updateData.name = name.trim();
      }

      if (ownerUserId !== undefined) {
        updateData.ownerUserId = ownerUserId;
      }

      const result = await db
        .update(organizations)
        .set(updateData)
        .where(eq(organizations.id, request.params.id))
        .returning();

      const organization = result[0];

      if (!organization) {
        return reply.code(404).send({
          status: "error",
          message: "Organization not found",
        });
      }

      return {
        status: "ok",
        data: organization,
      };
    },
  );

  // DELETE /api/v1/organizations/:id
  app.delete<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      const result = await db
        .delete(organizations)
        .where(eq(organizations.id, request.params.id))
        .returning();

      const organization = result[0];

      if (!organization) {
        return reply.code(404).send({
          status: "error",
          message: "Organization not found",
        });
      }

      return {
        status: "ok",
        message: "Organization deleted successfully",
        data: organization,
      };
    },
  );
}
