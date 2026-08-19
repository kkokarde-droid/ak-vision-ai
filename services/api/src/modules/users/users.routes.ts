import type { FastifyInstance } from "fastify";
import { and, eq, isNull, ne } from "drizzle-orm";

import {
  authSessions,
  db,
  users,
} from "@ak-vision-ai/database";

import {
  authenticate,
  requireRole,
} from "../../common/auth/auth.guard.js";

const USER_ROLES = [
  "customer",
  "admin",
  "super_admin",
] as const;

const USER_STATUSES = [
  "pending",
  "active",
  "suspended",
] as const;

const ACCOUNT_TYPES = [
  "individual",
  "business",
  "enterprise",
] as const;

type UserRole = (typeof USER_ROLES)[number];
type UserStatus = (typeof USER_STATUSES)[number];
type AccountType = (typeof ACCOUNT_TYPES)[number];

function sanitizeUser(
  user: typeof users.$inferSelect,
) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    accountType: user.accountType,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function isUserRole(
  value: unknown,
): value is UserRole {
  return (
    typeof value === "string" &&
    USER_ROLES.includes(value as UserRole)
  );
}

function isUserStatus(
  value: unknown,
): value is UserStatus {
  return (
    typeof value === "string" &&
    USER_STATUSES.includes(value as UserStatus)
  );
}

function isAccountType(
  value: unknown,
): value is AccountType {
  return (
    typeof value === "string" &&
    ACCOUNT_TYPES.includes(value as AccountType)
  );
}

export async function usersRoutes(
  app: FastifyInstance,
) {
  /*
   * Every users-management endpoint requires:
   *
   * 1. Valid authentication
   * 2. admin or super_admin role
   */
  app.addHook(
    "preHandler",
    authenticate,
  );

  app.addHook(
    "preHandler",
    requireRole(
      "admin",
      "super_admin",
    ),
  );

  // GET /api/v1/users
  app.get(
    "/",
    async () => {
      const result = await db
        .select()
        .from(users)
        .orderBy(users.createdAt);

      return {
        status: "ok",
        data: result.map(sanitizeUser),
      };
    },
  );

  // GET /api/v1/users/:id
  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/:id",
    async (request, reply) => {
      const result = await db
        .select()
        .from(users)
        .where(
          eq(
            users.id,
            request.params.id,
          ),
        )
        .limit(1);

      const user = result[0];

      if (!user) {
        return reply.code(404).send({
          status: "error",
          message: "User not found",
        });
      }

      return {
        status: "ok",
        data: sanitizeUser(user),
      };
    },
  );

  // POST /api/v1/users
  app.post<{
    Body: {
      email: string;
      displayName: string;
      role?: UserRole;
      status?: UserStatus;
      accountType?: AccountType;
    };
  }>(
    "/",
    async (request, reply) => {
      const {
        email,
        displayName,
        role = "customer",
        status = "pending",
        accountType = "individual",
      } = request.body;

      const actor = request.auth;

      if (!actor) {
        return reply.code(401).send({
          status: "error",
          message:
            "Authentication required",
        });
      }

      const normalizedEmail =
        email?.trim().toLowerCase();

      const normalizedDisplayName =
        displayName?.trim();

      if (
        !normalizedEmail ||
        !normalizedDisplayName
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "email and displayName are required",
        });
      }

      if (!isUserRole(role)) {
        return reply.code(400).send({
          status: "error",
          message: "Invalid user role",
        });
      }

      if (!isUserStatus(status)) {
        return reply.code(400).send({
          status: "error",
          message: "Invalid user status",
        });
      }

      if (!isAccountType(accountType)) {
        return reply.code(400).send({
          status: "error",
          message:
            "Invalid account type",
        });
      }

      /*
       * Only super_admin can create:
       * - admin
       * - super_admin
       *
       * Normal admins can create customers only.
       */
      if (
        role !== "customer" &&
        actor.role !== "super_admin"
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Only super_admin can create privileged accounts",
        });
      }

      /*
       * A super_admin must never be created through
       * this generic endpoint unless the actor is already
       * super_admin.
       */
      if (
        role === "super_admin" &&
        actor.role !== "super_admin"
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Only super_admin can create a super_admin",
        });
      }

      const existing = await db
        .select({
          id: users.id,
        })
        .from(users)
        .where(
          eq(
            users.email,
            normalizedEmail,
          ),
        )
        .limit(1);

      if (existing[0]) {
        return reply.code(409).send({
          status: "error",
          message:
            "An account with this email already exists",
        });
      }

      const result = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          displayName:
            normalizedDisplayName,
          role,
          status,
          accountType,
        })
        .returning();

      const user = result[0];

      if (!user) {
        return reply.code(500).send({
          status: "error",
          message:
            "Failed to create user",
        });
      }

      return reply.code(201).send({
        status: "ok",
        data: sanitizeUser(user),
      });
    },
  );

  // PATCH /api/v1/users/:id
  app.patch<{
    Params: {
      id: string;
    };
    Body: {
      email?: string;
      displayName?: string;
      role?: UserRole;
      status?: UserStatus;
      accountType?: AccountType;
    };
  }>(
    "/:id",
    async (request, reply) => {
      const { id } = request.params;

      const {
        email,
        displayName,
        role,
        status,
        accountType,
      } = request.body;

      const actor = request.auth;

      if (!actor) {
        return reply.code(401).send({
          status: "error",
          message:
            "Authentication required",
        });
      }

      const targetResult = await db
        .select({
          id: users.id,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .where(
          eq(users.id, id),
        )
        .limit(1);

      const target = targetResult[0];

      if (!target) {
        return reply.code(404).send({
          status: "error",
          message: "User not found",
        });
      }

      /*
       * Super-admin accounts are protected from the
       * generic user-management endpoint.
       */
      if (
        target.role === "super_admin" &&
        actor.userId !== target.id
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Super admin account is protected",
        });
      }

      /*
       * Role changes are extremely sensitive.
       *
       * Only super_admin may change roles.
       *
       * Existing super_admin accounts cannot be
       * promoted/demoted through this endpoint.
       */
      if (role !== undefined) {
        if (!isUserRole(role)) {
          return reply.code(400).send({
            status: "error",
            message:
              "Invalid user role",
          });
        }

        if (
          actor.role !== "super_admin"
        ) {
          return reply.code(403).send({
            status: "error",
            message:
              "Only super_admin can change user roles",
          });
        }

        if (
          target.role === "super_admin"
        ) {
          return reply.code(403).send({
            status: "error",
            message:
              "Super admin roles cannot be changed here",
          });
        }
      }

      if (
        status !== undefined &&
        !isUserStatus(status)
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "Invalid user status",
        });
      }

      if (
        accountType !== undefined &&
        !isAccountType(accountType)
      ) {
        return reply.code(400).send({
          status: "error",
          message:
            "Invalid account type",
        });
      }

      const updateData: {
        email?: string;
        displayName?: string;
        role?: UserRole;
        status?: UserStatus;
        accountType?: AccountType;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if (email !== undefined) {
        const normalizedEmail =
          email.trim().toLowerCase();

        if (!normalizedEmail) {
          return reply.code(400).send({
            status: "error",
            message:
              "Email cannot be empty",
          });
        }

        const duplicate = await db
          .select({
            id: users.id,
          })
          .from(users)
          .where(
            and(
              eq(
                users.email,
                normalizedEmail,
              ),
              ne(users.id, id),
            ),
          )
          .limit(1);

        if (duplicate[0]) {
          return reply.code(409).send({
            status: "error",
            message:
              "An account with this email already exists",
          });
        }

        updateData.email =
          normalizedEmail;
      }

      if (
        displayName !== undefined
      ) {
        const normalizedDisplayName =
          displayName.trim();

        if (!normalizedDisplayName) {
          return reply.code(400).send({
            status: "error",
            message:
              "Display name cannot be empty",
          });
        }

        updateData.displayName =
          normalizedDisplayName;
      }

      if (role !== undefined) {
        updateData.role = role;
      }

      if (status !== undefined) {
        updateData.status = status;
      }

      if (accountType !== undefined) {
        updateData.accountType =
          accountType;
      }

      const result = await db
        .update(users)
        .set(updateData)
        .where(
          eq(users.id, id),
        )
        .returning();

      const user = result[0];

      if (!user) {
        return reply.code(404).send({
          status: "error",
          message:
            "User not found",
        });
      }

      /*
       * If an account becomes suspended,
       * immediately revoke all active sessions.
       */
      if (
        status === "suspended" &&
        target.status !== "suspended"
      ) {
        await db
          .update(authSessions)
          .set({
            revokedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(
                authSessions.userId,
                id,
              ),
              isNull(authSessions.revokedAt),
            ),
          );
      }

      return {
        status: "ok",
        data: sanitizeUser(user),
      };
    },
  );

  // DELETE /api/v1/users/:id
  app.delete<{
    Params: {
      id: string;
    };
  }>(
    "/:id",
    async (request, reply) => {
      const actor = request.auth;

      if (!actor) {
        return reply.code(401).send({
          status: "error",
          message:
            "Authentication required",
        });
      }

      const targetResult = await db
        .select({
          id: users.id,
          role: users.role,
        })
        .from(users)
        .where(
          eq(
            users.id,
            request.params.id,
          ),
        )
        .limit(1);

      const target = targetResult[0];

      if (!target) {
        return reply.code(404).send({
          status: "error",
          message:
            "User not found",
        });
      }

      /*
       * Never allow deletion of a super_admin
       * through this endpoint.
       */
      if (
        target.role === "super_admin"
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Super admin accounts cannot be deleted here",
        });
      }

      /*
       * Admins cannot delete admins.
       * Only super_admin can delete privileged accounts.
       */
      if (
        target.role === "admin" &&
        actor.role !== "super_admin"
      ) {
        return reply.code(403).send({
          status: "error",
          message:
            "Only super_admin can delete admin accounts",
        });
      }

      /*
       * Revoke sessions before deleting the user.
       * Database cascade will also remove auth_sessions,
       * but this makes the security intent explicit.
       */
      await db
        .update(authSessions)
        .set({
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              authSessions.userId,
              target.id,
            ),
            isNull(authSessions.revokedAt),
          ),
        );

      const result = await db
        .delete(users)
        .where(
          eq(
            users.id,
            request.params.id,
          ),
        )
        .returning();

      const user = result[0];

      if (!user) {
        return reply.code(404).send({
          status: "error",
          message:
            "User not found",
        });
      }

      return {
        status: "ok",
        message:
          "User deleted successfully",
        data: sanitizeUser(user),
      };
    },
  );
}
