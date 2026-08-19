import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  db,
  users,
} from "@ak-vision-ai/database";

import { eq } from "drizzle-orm";

import {
  getSessionByToken,
} from "./session.service.js";

export const SESSION_COOKIE =
  "ak_vision_session";

export type UserRole =
  | "customer"
  | "admin"
  | "super_admin";

declare module "fastify" {
  interface FastifyRequest {
    auth: {
      userId: string;
      sessionId: string;
      role: UserRole;
    } | null;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const token =
    request.cookies?.[SESSION_COOKIE];

  if (!token) {
    await reply.code(401).send({
      status: "error",
      message: "Authentication required",
    });

    return false;
  }

  const session =
    await getSessionByToken(token);

  if (!session) {
    reply.clearCookie(
      SESSION_COOKIE,
      {
        path: "/",
      },
    );

    await reply.code(401).send({
      status: "error",
      message: "Session expired or revoked",
    });

    return false;
  }

  const result = await db
    .select({
      id: users.id,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const user = result[0];

  if (!user) {
    reply.clearCookie(
      SESSION_COOKIE,
      {
        path: "/",
      },
    );

    await reply.code(401).send({
      status: "error",
      message: "User account no longer exists",
    });

    return false;
  }

  if (user.status !== "active") {
    reply.clearCookie(
      SESSION_COOKIE,
      {
        path: "/",
      },
    );

    await reply.code(403).send({
      status: "error",
      message: "Account is not available",
    });

    return false;
  }

  request.auth = {
    userId: session.userId,
    sessionId: session.id,
    role: user.role,
  };

  return true;
}

export function requireRole(
  ...allowedRoles: UserRole[]
) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> => {
    if (!request.auth) {
      await reply.code(401).send({
        status: "error",
        message: "Authentication required",
      });

      return false;
    }

    if (
      !allowedRoles.includes(request.auth.role)
    ) {
      await reply.code(403).send({
        status: "error",
        message: "Insufficient permissions",
      });

      return false;
    }

    return true;
  };
}