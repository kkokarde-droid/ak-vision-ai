import multipart from "@fastify/multipart";
import { generationRoutes } from "./modules/generation/generation.routes.js";
import { mediaRoutes } from "./modules/media/media.routes.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import cookie from "@fastify/cookie";
import { db } from "@ak-vision-ai/database";
import { sql } from "drizzle-orm";

import { registerErrorHandler } from "./common/errors/error-handler.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { adminGenerationRoutes } from "./modules/admin/admin-generation.routes.js";
import { adminCreditsRoutes } from "./modules/admin/admin-credits.routes.js";
import { organizationsRoutes } from "./modules/organizations/organizations.routes.js";
import { membershipsRoutes } from "./modules/memberships/memberships.routes.js";
import { projectsRoutes } from "./modules/projects/projects.routes.js";
import { conversationsRoutes } from "./modules/conversations/conversations.routes.js";
import { messagesRoutes } from "./modules/messages/messages.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { googleAuthRoutes } from "./modules/auth/google-auth.routes.js";
import { creditsRoutes } from "./modules/credits/credits.routes.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  app.register(helmet);

  const isProduction =
    process.env.NODE_ENV === "production";

  const configuredCorsOrigins =
    (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);

  if (
    isProduction &&
    configuredCorsOrigins.length === 0
  ) {
    throw new Error(
      "CORS_ORIGINS is required in production.",
    );
  }

  app.register(cors, {
    origin: isProduction
      ? configuredCorsOrigins
      : true,
  });

  app.register(cookie);

  app.register(sensible);

  app.register(authRoutes, {
    prefix: "/api/v1/auth",
  });

  app.register(googleAuthRoutes, {
    prefix: "/api/v1/auth",
  });
  app.register(usersRoutes, {
    prefix: "/api/v1/users",
  });

  app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 10 * 1024 * 1024,
    },
  });

  app.register(mediaRoutes, {
    prefix: "/api/v1/media",
  });

  app.register(organizationsRoutes, {
    prefix: "/api/v1/organizations",
  });

  app.register(membershipsRoutes, {
    prefix: "/api/v1/memberships",
  });

  app.register(projectsRoutes, {
    prefix: "/api/v1/projects",
  });

  app.register(conversationsRoutes, {
    prefix: "/api/v1/conversations",
  });

  app.register(messagesRoutes, {
    prefix: "/api/v1/messages",
  });

  app.register(creditsRoutes, {
    prefix: "/api/v1/credits",
  });    app.register(generationRoutes, {
    prefix: "/api/v1/generation",
  });

  app.register(adminGenerationRoutes, {
    prefix: "/api/v1/admin/generations",
  });

  app.register(adminCreditsRoutes, {
    prefix: "/api/v1/admin/credits",
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "ak-vision-ai-api",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health/db", async (_request, reply) => {
    try {
      const result = await db.execute(sql`
        SELECT
          current_database() AS database,
          current_user AS user_name
      `);

      return {
        status: "ok",
        service: "ak-vision-ai-api",
        database: "ok",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      app.log.error(error);

      return reply.code(503).send({
        status: "error",
        service: "ak-vision-ai-api",
        database: "error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  registerErrorHandler(app);

  return app;
}
