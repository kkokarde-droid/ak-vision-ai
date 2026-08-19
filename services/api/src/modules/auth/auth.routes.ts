import type {
  FastifyInstance,
  FastifyReply,
} from "fastify";

import {
  getSessionByToken,
  revokeSessionByToken,
} from "../../common/auth/session.service.js";

import {
  loginUser,
  registerUser,
} from "./auth.service.js";

const SESSION_COOKIE =
  "ak_vision_session";

const isProduction =
  process.env.NODE_ENV === "production";

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(
    SESSION_COOKIE,
    token,
    {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    },
  );
}

export async function authRoutes(
  app: FastifyInstance,
) {
  /*
   * REGISTER
   */
  app.post<{
    Body: {
      email: string;
      password: string;
      displayName: string;
      accountType?:
        | "individual"
        | "business"
        | "enterprise";
    };
  }>(
    "/register",
    async (request, reply) => {
      try {
        const result =
          await registerUser(
            request.body,
          );

        setSessionCookie(
          reply,
          result.session.token,
          result.session.expiresAt,
        );

        return reply.code(201).send({
          status: "ok",
          data: {
            user: result.user,
          },
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Registration failed";

        if (
          message.includes(
            "already exists",
          )
        ) {
          return reply
            .code(409)
            .send({
              status: "error",
              message,
            });
        }

        app.log.error(error);

        return reply
          .code(400)
          .send({
            status: "error",
            message,
          });
      }
    },
  );

  /*
   * LOGIN
   */
  app.post<{
    Body: {
      email: string;
      password: string;
    };
  }>(
    "/login",
    async (request, reply) => {
      try {
        const result =
          await loginUser(
            request.body,
          );

        setSessionCookie(
          reply,
          result.session.token,
          result.session.expiresAt,
        );

        return {
          status: "ok",
          data: {
            user: result.user,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Login failed";

        if (
          message ===
          "Invalid email or password"
        ) {
          return reply
            .code(401)
            .send({
              status: "error",
              message,
            });
        }

        if (
          message ===
          "Account is not available"
        ) {
          return reply
            .code(403)
            .send({
              status: "error",
              message,
            });
        }

        app.log.error(error);

        return reply
          .code(400)
          .send({
            status: "error",
            message,
          });
      }
    },
  );

  /*
   * LOGOUT
   */
  app.post(
    "/logout",
    async (request, reply) => {
      const token =
        request.cookies[
          SESSION_COOKIE
        ];

      if (token) {
        await revokeSessionByToken(
          token,
        );
      }

      reply.clearCookie(
        SESSION_COOKIE,
        {
          path: "/",
        },
      );

      return {
        status: "ok",
        message:
          "Logged out successfully",
      };
    },
  );

  /*
   * CURRENT USER
   */
  app.get(
    "/me",
    async (request, reply) => {
      const token =
        request.cookies[
          SESSION_COOKIE
        ];

      if (!token) {
        return reply
          .code(401)
          .send({
            status: "error",
            message:
              "Authentication required",
          });
      }

      const session =
        await getSessionByToken(
          token,
        );

      if (!session) {
        reply.clearCookie(
          SESSION_COOKIE,
          {
            path: "/",
          },
        );

        return reply
          .code(401)
          .send({
            status: "error",
            message:
              "Session expired or revoked",
          });
      }

      const {
        db,
        users,
      } =
        await import(
          "@ak-vision-ai/database"
        );

      const { eq } =
        await import(
          "drizzle-orm"
        );

      const result =
        await db
          .select()
          .from(users)
          .where(
            eq(
              users.id,
              session.userId,
            ),
          )
          .limit(1);

      const user = result[0];

      if (!user) {
        await revokeSessionByToken(
          token,
        );

        reply.clearCookie(
          SESSION_COOKIE,
          {
            path: "/",
          },
        );

        return reply
          .code(401)
          .send({
            status: "error",
            message:
              "User account no longer exists",
          });
      }

      return {
        status: "ok",
        data: {
          id: user.id,
          email: user.email,
          displayName:
            user.displayName,
          role: user.role,
          status: user.status,
          accountType:
            user.accountType,
          createdAt:
            user.createdAt,
          updatedAt:
            user.updatedAt,
        },
      };
    },
  );
}