import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";

import {
  db,
  generationJobs,
  generationOutputs,
  users,
} from "@ak-vision-ai/database";

import {
  authenticate,
  requireRole,
} from "../../common/auth/auth.guard.js";

const GenerationStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("processing"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

const GenerationListQuerySchema = Type.Object(
  {
    page: Type.Optional(
      Type.Integer({
        minimum: 1,
        default: 1,
      }),
    ),
    pageSize: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        default: 25,
      }),
    ),
    status: Type.Optional(
      GenerationStatusSchema,
    ),
    search: Type.Optional(
      Type.String({
        maxLength: 200,
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

const GenerationIdParamsSchema = Type.Object(
  {
    jobId: Type.String({
      format: "uuid",
    }),
  },
);

type GenerationStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

type ListQuery = {
  page?: number;
  pageSize?: number;
  status?: GenerationStatus;
  search?: string;
};

function toRecord(
  value: unknown,
): Record<string, unknown> {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }

  return {};
}

function extractDuration(
  input: unknown,
): number | null {
  const record = toRecord(input);
  return typeof record.duration === "number"
    ? record.duration
    : null;
}

function extractMode(
  input: unknown,
  providerModelId: string | null,
): string {
  const record = toRecord(input);

  if (
    typeof record.mode === "string" &&
    record.mode.trim()
  ) {
    return record.mode;
  }

  if (providerModelId === "seedance_2_0") {
    return "text_to_video";
  }

  if (
    providerModelId === "dop-lite" ||
    providerModelId === "dop-turbo" ||
    providerModelId === "dop-standard"
  ) {
    return "image_to_video";
  }

  return "unknown";
}

function extractCreditsRequired(
  pricingSnapshot: unknown,
): number | null {
  const snapshot = toRecord(
    pricingSnapshot,
  );

  const quote = toRecord(
    snapshot.quote,
  );

  return typeof quote.creditsRequired === "number"
    ? quote.creditsRequired
    : null;
}

function summarizeInput(
  input: unknown,
) {
  const record = toRecord(input);

  return {
    durationSeconds:
      typeof record.duration === "number"
        ? record.duration
        : null,
    enhancePrompt:
      typeof record.enhance_prompt === "boolean"
        ? record.enhance_prompt
        : null,
    seed:
      typeof record.seed === "number"
        ? record.seed
        : null,
    imageAssetProvided:
      typeof record.imageAssetId === "string" &&
      record.imageAssetId.length > 0,
  };
}

function summarizeOutput(
  output: {
    id: string;
    type: string;
    mimeType: string;
    sizeBytes: number | null;
    createdAt: Date;
  },
) {
  return {
    id: output.id,
    type: output.type,
    mimeType: output.mimeType,
    sizeBytes: output.sizeBytes,
    createdAt:
      output.createdAt.toISOString(),
  };
}

function buildWhere(
  query: ListQuery,
) {
  const conditions: SQL[] = [];

  if (query.status) {
    conditions.push(
      eq(
        generationJobs.status,
        query.status,
      ),
    );
  }

  const search =
    query.search?.trim();

  if (search) {
    const pattern = `%${search}%`;

    conditions.push(
      or(
        ilike(
          users.email,
          pattern,
        ),
        ilike(
          users.displayName,
          pattern,
        ),
        ilike(
          generationJobs.providerId,
          pattern,
        ),
        ilike(
          generationJobs.providerModelId,
          pattern,
        ),
        sql`${generationJobs.id}::text ILIKE ${pattern}`,
        sql`${generationJobs.requestId}::text ILIKE ${pattern}`,
      )!,
    );
  }

  return conditions.length > 0
    ? and(...conditions)
    : undefined;
}

function serializeJob(
  job: typeof generationJobs.$inferSelect,
  user: typeof users.$inferSelect,
  outputCount: number,
) {
  return {
    id: job.id,
    requestId: job.requestId,
    customer: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
    type: job.type,
    mode: extractMode(
      job.input,
      job.providerModelId,
    ),
    status: job.status,
    priority: job.priority,
    progress: job.progress,
    durationSeconds:
      extractDuration(job.input),
    creditsRequired:
      extractCreditsRequired(
        job.pricingSnapshot,
      ),
    provider: {
      id: job.providerId,
      modelId: job.providerModelId,
    },
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    outputCount,
    error:
      job.status === "failed"
        ? {
            code: job.errorCode,
            message:
              job.errorMessage ??
              "Generation failed",
          }
        : null,
    createdAt:
      job.createdAt.toISOString(),
    startedAt:
      job.startedAt?.toISOString() ??
      null,
    completedAt:
      job.completedAt?.toISOString() ??
      null,
    updatedAt:
      job.updatedAt.toISOString(),
  };
}

export async function adminGenerationRoutes(
  app: FastifyInstance,
) {
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

  // GET /api/v1/admin/generations
  app.get<{
    Querystring: ListQuery;
  }>(
    "/",
    {
      schema: {
        querystring:
          GenerationListQuerySchema,
      },
    },
    async (request) => {
      const page =
        request.query.page ?? 1;
      const pageSize =
        request.query.pageSize ?? 25;
      const offset =
        (page - 1) * pageSize;

      const where =
        buildWhere(request.query);

      const totalResult =
        await db
          .select({
            count: count(),
          })
          .from(generationJobs)
          .innerJoin(
            users,
            eq(
              generationJobs.userId,
              users.id,
            ),
          )
          .where(where);

      const total = Number(
        totalResult[0]?.count ?? 0,
      );

      const rows =
        await db
          .select({
            job: generationJobs,
            user: users,
          })
          .from(generationJobs)
          .innerJoin(
            users,
            eq(
              generationJobs.userId,
              users.id,
            ),
          )
          .where(where)
          .orderBy(
            desc(
              generationJobs.createdAt,
            ),
          )
          .limit(pageSize)
          .offset(offset);

      const jobIds = rows.map(
        ({ job }) => job.id,
      );

      const outputCounts = new Map<
        string,
        number
      >();

      if (jobIds.length > 0) {
        const counts =
          await db
            .select({
              jobId:
                generationOutputs.jobId,
              count: count(),
            })
            .from(generationOutputs)
            .where(
              inArray(
                generationOutputs.jobId,
                jobIds,
              ),
            )
            .groupBy(
              generationOutputs.jobId,
            );

        for (const row of counts) {
          outputCounts.set(
            row.jobId,
            Number(row.count),
          );
        }
      }

      return {
        status: "ok",
        data: rows.map(
          ({ job, user }) =>
            serializeJob(
              job,
              user,
              outputCounts.get(
                job.id,
              ) ?? 0,
            ),
        ),
        meta: {
          page,
          pageSize,
          total,
          totalPages:
            total === 0
              ? 0
              : Math.ceil(
                  total / pageSize,
                ),
        },
      };
    },
  );

  // GET /api/v1/admin/generations/:jobId
  app.get<{
    Params: {
      jobId: string;
    };
  }>(
    "/:jobId",
    {
      schema: {
        params:
          GenerationIdParamsSchema,
      },
    },
    async (request, reply) => {
      const result =
        await db
          .select({
            job: generationJobs,
            user: users,
          })
          .from(generationJobs)
          .innerJoin(
            users,
            eq(
              generationJobs.userId,
              users.id,
            ),
          )
          .where(
            eq(
              generationJobs.id,
              request.params.jobId,
            ),
          )
          .limit(1);

      const row = result[0];

      if (!row) {
        return reply.code(404).send({
          status: "error",
          message:
            "Generation job not found",
        });
      }

      const outputs =
        await db
          .select({
            id:
              generationOutputs.id,
            type:
              generationOutputs.type,
            mimeType:
              generationOutputs.mimeType,
            sizeBytes:
              generationOutputs.sizeBytes,
            createdAt:
              generationOutputs.createdAt,
          })
          .from(generationOutputs)
          .where(
            eq(
              generationOutputs.jobId,
              row.job.id,
            ),
          )
          .orderBy(
            desc(
              generationOutputs.createdAt,
            ),
          );

      return {
        status: "ok",
        data: {
          ...serializeJob(
            row.job,
            row.user,
            outputs.length,
          ),
          prompt: row.job.prompt,
          input: summarizeInput(
            row.job.input,
          ),
          outputs: outputs.map(
            summarizeOutput,
          ),
        },
      };
    },
  );
}
