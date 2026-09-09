import { and, eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createWriteStream,
  promises as fs,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";

import {
  artifacts,
  db,
} from "@ak-vision-ai/database";

import {
  LocalMediaStorage,
  MediaStorageError,
} from "@ak-vision-ai/storage";

import { authenticate } from "../../common/auth/auth.guard.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const ArtifactParamsSchema =
  Type.Object({
    artifactId: Type.String({
      format: "uuid",
    }),
  });

const ProviderMediaParamsSchema =
  Type.Object({
    artifactId: Type.String({
      format: "uuid",
    }),
    token: Type.String({
      minLength: 64,
      maxLength: 64,
      pattern: "^[a-f0-9]+$",
    }),
  });

function createStorage() {
  const rootDirectory =
    process.env.MEDIA_STORAGE_ROOT?.trim() ||
    join(
      process.cwd(),
      "..",
      "worker",
      "worker-storage",
    );

  return new LocalMediaStorage({
    rootDirectory,
  });
}

function providerBaseUrl() {
  const value =
    process.env.MEDIA_PUBLIC_BASE_URL?.trim()
      .replace(/\/+$/, "");

  if (!value) {
    throw new Error(
      "MEDIA_PUBLIC_BASE_URL is required for provider-readable media.",
    );
  }

  const parsed = new URL(value);

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    throw new Error(
      "MEDIA_PUBLIC_BASE_URL must use http:// or https://.",
    );
  }

  return value;
}

function providerToken(
  metadata: unknown,
) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return null;
  }

  const value =
    (
      metadata as Record<
        string,
        unknown
      >
    ).providerToken;

  return typeof value === "string" &&
    /^[a-f0-9]{64}$/.test(value)
    ? value
    : null;
}

export async function mediaRoutes(
  app: FastifyInstance,
) {
  app.addHook(
    "preHandler",
    authenticate,
  );

  app.post(
    "/upload",
    {
    },
    async (request, reply) => {
      const actor =
        request.auth!;

      let part;

      try {
        part =
          await request.file({
            limits: {
              files: 1,
              fileSize:
                MAX_IMAGE_BYTES,
            },
          });
      } catch (error) {
        return reply
          .code(400)
          .send({
            status: "error",
            code: "INVALID_MEDIA_UPLOAD",
            message:
              error instanceof Error
                ? error.message
                : "Image upload failed.",
          });
      }

      if (!part) {
        return reply
          .code(400)
          .send({
            status: "error",
            code: "INVALID_MEDIA_UPLOAD",
            message:
              "An image file is required.",
          });
      }

      const extension =
        IMAGE_TYPES.get(
          part.mimetype,
        );

      if (!extension) {
        part.file.resume();

        return reply
          .code(400)
          .send({
            status: "error",
            code: "UNSUPPORTED_MEDIA_TYPE",
            message:
              "Only JPEG, PNG, and WebP images are supported.",
          });
      }

      const tempPath = join(
        tmpdir(),
        `ak-vision-${randomUUID()}.${extension}`,
      );

      const assetId =
        randomUUID();

      const token =
        randomBytes(32).toString(
          "hex",
        );

      const storageKey =
        `customer-inputs/${actor.userId}/${assetId}.${extension}`;

      try {
        await pipeline(
          part.file,
          createWriteStream(
            tempPath,
          ),
        );

        if (part.file.truncated) {
          throw new MediaStorageError(
            "Image exceeds the 10 MB limit.",
          );
        }

        const stat =
          await fs.stat(
            tempPath,
          );

        if (
          !Number.isSafeInteger(
            stat.size,
          ) ||
          stat.size <= 0 ||
          stat.size >
            MAX_IMAGE_BYTES
        ) {
          throw new MediaStorageError(
            "Image size is invalid.",
          );
        }

        const stored =
          await createStorage().putFile({
            sourcePath:
              tempPath,
            key: storageKey,
            contentType:
              part.mimetype,
          });

        try {
          const result =
            await db
              .insert(artifacts)
              .values({
                id: assetId,
                ownerUserId:
                  actor.userId,
                name:
                  part.filename?.trim() ||
                  `Reference image.${extension}`,
                storageKey:
                  stored.key,
                type: "image",
                status: "ready",
                mimeType:
                  stored.contentType,
                sizeBytes:
                  stored.sizeBytes,
                metadata: {
                  source:
                    "customer-upload",
                  providerToken:
                    token,
                },
              })
              .returning();

          const artifact =
            result[0];

          if (!artifact) {
            throw new Error(
              "Image asset could not be created.",
            );
          }

          return reply
            .code(201)
            .send({
              status: "ok",
              data: {
                asset: {
                  id:
                    artifact.id,
                  name:
                    artifact.name,
                  type:
                    artifact.type,
                  status:
                    artifact.status,
                  mimeType:
                    artifact.mimeType,
                  sizeBytes:
                    artifact.sizeBytes,
                  previewUrl:
                    `/api/v1/media/${artifact.id}`,
                },
              },
            });
        } catch (error) {
          await createStorage()
            .delete(stored.key)
            .catch(() => undefined);

          throw error;
        }
      } catch (error) {
        return reply
          .code(400)
          .send({
            status: "error",
            code: "INVALID_MEDIA_UPLOAD",
            message:
              error instanceof Error
                ? error.message
                : "Image upload failed.",
          });
      } finally {
        await fs
          .unlink(tempPath)
          .catch(() => undefined);
      }
    },
  );

  app.get<{
    Params: {
      artifactId: string;
    };
  }>(
    "/:artifactId",
    {
      schema: {
        params:
          ArtifactParamsSchema,
      },
    },
    async (request, reply) => {
      const actor =
        request.auth!;

      const result =
        await db
          .select()
          .from(artifacts)
          .where(
            and(
              eq(
                artifacts.id,
                request.params
                  .artifactId,
              ),
              eq(
                artifacts.ownerUserId,
                actor.userId,
              ),
            ),
          )
          .limit(1);

      const artifact =
        result[0];

      if (
        !artifact ||
        artifact.type !== "image" ||
        artifact.status !== "ready" ||
        !artifact.storageKey
      ) {
        return reply
          .code(404)
          .send({
            status: "error",
            code: "NOT_FOUND",
            message:
              "Image asset not found.",
          });
      }

      try {
        const media =
          await createStorage().openFile(
            artifact.storageKey,
          );

        return reply
          .type(
            artifact.mimeType ||
              "application/octet-stream",
          )
          .header(
            "Content-Length",
            String(media.sizeBytes),
          )
          .header(
            "Content-Disposition",
            'inline; filename="Reference Image"',
          )
          .header(
            "Cache-Control",
            "private, max-age=300",
          )
          .send(media.stream);
      } catch {
        return reply
          .code(404)
          .send({
            status: "error",
            code: "NOT_FOUND",
            message:
              "Image asset is unavailable.",
          });
      }
    },
  );

  app.get<{
    Params: {
      artifactId: string;
      token: string;
    };
  }>(
    "/provider/:artifactId/:token",
    {
      schema: {
        params:
          ProviderMediaParamsSchema,
      },
    },
    async (request, reply) => {
      const result =
        await db
          .select()
          .from(artifacts)
          .where(
            eq(
              artifacts.id,
              request.params
                .artifactId,
            ),
          )
          .limit(1);

      const artifact =
        result[0];

      const storedToken =
        artifact
          ? providerToken(
              artifact.metadata,
            )
          : null;

      if (
        !artifact ||
        artifact.type !== "image" ||
        artifact.status !== "ready" ||
        !artifact.storageKey ||
        storedToken === null ||
        storedToken !==
          request.params.token
      ) {
        return reply
          .code(404)
          .send({
            status: "error",
            code: "NOT_FOUND",
            message:
              "Media asset not found.",
          });
      }

      try {
        const media =
          await createStorage().openFile(
            artifact.storageKey,
          );

        return reply
          .type(
            artifact.mimeType ||
              "application/octet-stream",
          )
          .header(
            "Content-Length",
            String(media.sizeBytes),
          )
          .header(
            "Content-Disposition",
            'inline; filename="reference-image"',
          )
          .header(
            "Cache-Control",
            "public, max-age=300",
          )
          .send(media.stream);
      } catch {
        return reply
          .code(404)
          .send({
            status: "error",
            code: "NOT_FOUND",
            message:
              "Media asset is unavailable.",
          });
      }
    },
  );
}

