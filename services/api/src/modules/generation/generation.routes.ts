import {  and,  eq,  isNull,  or,  sql,} from "drizzle-orm";import type { FastifyInstance } from "fastify";import { Type } from "@sinclair/typebox";import { resolve } from "node:path";import {  artifacts,  db,  generationJobs,  generationOutputs,  organizationMemberships,  organizations,} from "@ak-vision-ai/database";import {  CreditRepositoryError,  releaseReservationTx,  reserveCreditsTx,} from "@ak-vision-ai/credits";import {  GenerationRepositoryError,  cancelGenerationJobTx,  createGenerationJobTx,  getGenerationJob,  listGenerationOutputs,} from "@ak-vision-ai/generation";import {  LocalMediaStorage,  MediaStorageError,} from "@ak-vision-ai/storage";import { authenticate } from "../../common/auth/auth.guard.js";import {  calculateGenerationPrice,  PricingError,  resolveGenerationPricingTx,} from "@ak-vision-ai/pricing";const GenerationJobIdParamsSchema =  Type.Object({    jobId: Type.String({      format: "uuid",    }),  });const GenerationOutputParamsSchema =  Type.Object({    jobId: Type.String({      format: "uuid",    }),    outputId: Type.String({      format: "uuid",    }),  });const GenerationCreateBodySchema =  Type.Object({    requestId: Type.String({      format: "uuid",    }),    mode: Type.Optional(      Type.Union([        Type.Literal("text_to_video"),        Type.Literal("image_to_video"),        Type.Literal("video_to_video"),        Type.Literal("ai_director"),      ]),    ),    providerModelId: Type.Optional(  Type.Union([    Type.Literal("dop-lite"),    Type.Literal("dop-turbo"),    Type.Literal("dop-standard"),  ]),),    prompt: Type.String({      minLength: 1,      maxLength: 10000,    }),    imageAssetId: Type.Optional(      Type.String({        format: "uuid",      }),    ),    imageUrl: Type.Optional(      Type.String({        format: "uri",        maxLength: 4000,      }),    ),    durationSeconds: Type.Integer({ minimum: 3, maximum: 15 }),    priority: Type.Optional(      Type.Union([        Type.Literal("low"),        Type.Literal("normal"),        Type.Literal("high"),      ]),    ),    organizationId: Type.Optional(      Type.String({        format: "uuid",      }),    ),    enhancePrompt: Type.Optional(      Type.Boolean(),    ),    seed: Type.Optional(      Type.Integer({        minimum: 0,      }),    ),  }, {    additionalProperties: false,  });const GenerationQuoteBodySchema = Type.Object({
  mode: Type.Union([
    Type.Literal("text_to_video"),
    Type.Literal("image_to_video"),
    Type.Literal("video_to_video"),
    Type.Literal("ai_director"),
  ]),
  durationSeconds: Type.Integer({ minimum: 3, maximum: 15 }),
}, {
  additionalProperties: false,
});
const GenerationReadQuerySchema =  Type.Object({    organizationId: Type.Optional(      Type.String({        format: "uuid",      }),    ),  }, {    additionalProperties: false,  });function toCustomerGenerationJob(  job: Awaited<    ReturnType<typeof getGenerationJob>  >,) {  if (!job) {    return null;  }  return {    id: job.id,    requestId: job.requestId,    projectId: job.projectId,    conversationId: job.conversationId,    type: job.type,    status: job.status,    priority: job.priority,    prompt: job.prompt,    progress: job.progress,    startedAt:      job.startedAt?.toISOString() ??      null,    completedAt:      job.completedAt?.toISOString() ??      null,    createdAt:      job.createdAt.toISOString(),    updatedAt:      job.updatedAt.toISOString(),    error:      job.status === "failed"        ? {            message:              job.errorMessage ??              "Generation failed",          }        : null,  };}function toCustomerGenerationOutput(  jobId: string,  output: {    id: string;    type: string;    mimeType: string;    sizeBytes: number | null;    createdAt: Date;  },) {  return {    id: output.id,    type: output.type,    url:      `/api/v1/generation/${jobId}/output/${output.id}`,    mimeType: output.mimeType,    sizeBytes: output.sizeBytes,    createdAt:      output.createdAt.toISOString(),  };}function mapGenerationError(  error: unknown,) {  if (    error instanceof GenerationRepositoryError  ) {    switch (error.code) {      case "INVALID_INPUT":        return {          statusCode: 400,          code: "BAD_REQUEST",          message: error.message,        };      case "NOT_FOUND":        return {          statusCode: 404,          code: "NOT_FOUND",          message: error.message,        };      case "IDEMPOTENCY_CONFLICT":        return {          statusCode: 409,          code: "IDEMPOTENCY_CONFLICT",          message: error.message,        };      case "INVALID_STATE":      case "LEASE_CONFLICT":        return {          statusCode: 409,          code: "INVALID_STATE",          message: error.message,        };    }  }  if (error instanceof PricingError) {    switch (error.code) {      case "INVALID_INPUT":        return {          statusCode: 400,          code: "BAD_REQUEST",          message: error.message,        };      case "PRICING_NOT_FOUND":        return {          statusCode: 404,          code: "PRICING_NOT_FOUND",          message: error.message,        };      case "PRICING_CONFLICT":        return {          statusCode: 409,          code: "PRICING_CONFLICT",          message: error.message,        };      case "UNSUPPORTED_CURRENCY":        return {          statusCode: 400,          code: "UNSUPPORTED_CURRENCY",          message: error.message,        };    }  }  if (    error instanceof CreditRepositoryError  ) {    switch (error.code) {      case "NOT_FOUND":        return {          statusCode: 404,          code: "NOT_FOUND",          message: error.message,        };      case "IDEMPOTENCY_CONFLICT":      case "INVALID_STATE":        return {          statusCode: 409,          code: error.code,          message: error.message,        };      case "INSUFFICIENT_CREDITS":        return {          statusCode: 402,          code: "INSUFFICIENT_CREDITS",          message: error.message,        };    }  }  return null;}export async function generationRoutes(  app: FastifyInstance,) {  app.addHook(    "preHandler",    authenticate,  );  /**   * POST /api/v1/generation   *   * V1 authoritative customer generation creation.   *   * Financial values are calculated server-side from   * authoritative pricing. Reservation + job creation +   * pricing snapshot share one PostgreSQL transaction.   */  /**
   * POST /api/v1/generation/quote
   *
   * Customer-safe, server-authoritative pricing preview.
   *
   * This endpoint ONLY resolves pricing. It does not:
   * - reserve credits
   * - create a generation job
   * - expose provider cost
   * - expose provider model identifiers
   *
   * The final POST /generation endpoint recalculates
   * pricing and performs the authoritative reservation.
   */
  app.post<{
    Body: {
      mode:
        | "text_to_video"
        | "image_to_video"
        | "video_to_video"
        | "ai_director";
      durationSeconds: number;
    };
  }>(
    "/quote",
    {
      schema: {
        body: GenerationQuoteBodySchema,
      },
    },
    async (request, reply) => {
      const mode = request.body.mode;

      let providerModelId:
        | "seedance_2_0"
        | "dop-turbo";

      switch (mode) {
        case "text_to_video":
          providerModelId = "seedance_2_0";
          break;

        case "image_to_video":
          providerModelId = "dop-turbo";
          break;

        case "video_to_video":
        case "ai_director":
          return reply
            .code(400)
            .send({
              status: "error",
              code: "BAD_REQUEST",
              message:
                `${mode} is not available yet.`,
            });

        default:
          return reply
            .code(400)
            .send({
              status: "error",
              code: "BAD_REQUEST",
              message:
                "Unsupported generation mode.",
            });
      }

      try {
        const quoteTime = new Date();

        const pricing = await db.transaction(
          async (tx) => {
            const resolved =
              await resolveGenerationPricingTx(
                tx,
                {
                  providerModelId,
                  unit: "second",
                  currency: "INR",
                  asOf: quoteTime,
                },
              );

            return calculateGenerationPrice({
              providerModelId,
              unit: "second",
              quantity: request.body.durationSeconds,
              pricing: resolved.pricing,
              policy: resolved.policy,
              asOf: quoteTime,
            });
          },
        );

        return reply.send({
          status: "ok",
          data: {
            pricingVersion:
              pricing.pricingVersion,
            currency:
              pricing.currency,
            creditsRequired:
              pricing.creditsRequired,
            customerChargeMinor:
              pricing.customerChargeMinor,
            quotedAt:
              pricing.quotedAt,
          },
        });
      } catch (error) {
        const mapped =
          mapGenerationError(error);

        if (mapped) {
          return reply
            .code(mapped.statusCode)
            .send({
              status: "error",
              code: mapped.code,
              message: mapped.message,
            });
        }

        throw error;
      }
    },
  );
  app.post<{    Body: {      requestId: string;      providerModelId?:  | "dop-lite"  | "dop-turbo"  | "dop-standard";  mode?:    | "text_to_video"    | "image_to_video"    | "video_to_video"    | "ai_director";      prompt: string;      imageAssetId?: string;      imageUrl?: string;      durationSeconds: number;      priority?: "low" | "normal" | "high";      organizationId?: string;      enhancePrompt?: boolean;      seed?: number;    };  }>(    "/",    {      schema: {        body: GenerationCreateBodySchema,      },    },    async (request, reply) => {      const actor = request.auth!;

      const generationExecutionMode =
        process.env.GENERATION_EXECUTION_MODE?.trim() ||
        "live";

      if (
        generationExecutionMode !== "live" &&
        generationExecutionMode !== "mock"
      ) {
        throw new GenerationRepositoryError(
          "Invalid GENERATION_EXECUTION_MODE.",
          "INVALID_STATE",
        );
      }

      if (
        generationExecutionMode === "mock" &&
        process.env.NODE_ENV === "production"
      ) {
        throw new GenerationRepositoryError(
          "Development MockVideoProvider cannot be enabled in production.",
          "INVALID_STATE",
        );
      }

      const textToVideoProviderId =
        generationExecutionMode === "mock"
          ? "mock-video"
          : "fal";

      const mode =
        request.body.mode ??
        (
          request.body.providerModelId !==
          undefined
            ? "image_to_video"
            : undefined
        );

      try {
      if (!mode) {
        throw new GenerationRepositoryError(
          "Generation mode is required.",
          "INVALID_INPUT",
        );
      }
      if (
        mode === "text_to_video" &&
        (
          !Number.isInteger(request.body.durationSeconds) ||
          request.body.durationSeconds < 4 ||
          request.body.durationSeconds > 15
        )
      ) {
        throw new GenerationRepositoryError(
          "Text-to-video duration must be between 4 and 15 seconds.",
          "INVALID_INPUT",
        );
      }

      if (
        mode === "image_to_video" &&
        ![3, 5].includes(request.body.durationSeconds)
      ) {
        throw new GenerationRepositoryError(
          "Image-to-video currently supports 3 or 5 seconds.",
          "INVALID_INPUT",
        );
      }
      let providerModelId:        | "seedance_2_0"        | "dop-lite"        | "dop-turbo"        | "dop-standard";      switch (mode) {        case "text_to_video":          providerModelId =            "seedance_2_0";          break;        case "image_to_video":          providerModelId =            request.body.providerModelId ??            "dop-turbo";          break;        case "video_to_video":        case "ai_director":          throw new GenerationRepositoryError(            `${mode} is not available yet.`,            "INVALID_INPUT",          );        default:          throw new GenerationRepositoryError(            "Unsupported generation mode.",            "INVALID_INPUT",          );      }        const result =          await db.transaction(            async (tx) => {              /*               * requestId is the API idempotency boundary.               * Serialize identical requests before pricing,               * reservation, and job creation.               */              await tx.execute(                sql.raw(                  "select pg_advisory_xact_lock(" +                  "hashtextextended('" +                  request.body.requestId.replace(/'/g, "''") +                  "', 0))",                ),              );              const existingResult =                await tx                  .select()                  .from(generationJobs)                  .where(                    eq(                      generationJobs.requestId,                      request.body.requestId,                    ),                  )                  .limit(1);              const existing =                existingResult[0];              if (existing) {                if (                  existing.userId !==                    actor.userId ||                  (existing.organizationId ??                    null) !==                    (request.body.organizationId ??                      null)                ) {                  throw new GenerationRepositoryError(                    "Generation request belongs to a different owner",                    "IDEMPOTENCY_CONFLICT",                  );                }                const existingInput =                  (existing.input ??                    {}) as Record<                    string,                    unknown                  >;                                const existingMode =
  typeof existingInput.mode === "string"
    ? existingInput.mode
    : existing.providerModelId === "dop-turbo"
      ? "image_to_video"
      : "text_to_video";

const requestedMode = mode;

const requestedImageInput =
  request.body.imageAssetId ??
  request.body.imageUrl?.trim() ??
  null;

const existingImageInput =
  typeof existingInput.imageAssetId === "string"
    ? existingInput.imageAssetId
    : typeof existingInput.imageUrl === "string"
      ? existingInput.imageUrl
      : null;

const existingDuration =
  Number(existingInput.duration);

const requestedDuration =
  Number(request.body.durationSeconds);

                const existingEnhancePrompt =
                  existingInput.enhance_prompt === undefined
                    ? true
                    : Boolean(existingInput.enhance_prompt);

                const requestedEnhancePrompt =
                  request.body.enhancePrompt ?? true;

                const existingSeed =
                  existingInput.seed === undefined
                    ? undefined
                    : Number(existingInput.seed);

                const requestedSeed =
                  request.body.seed === undefined
                    ? undefined
                    : Number(request.body.seed);

                const sameSeed =
                  existingSeed === undefined
                    ? requestedSeed === undefined
                    : existingSeed === requestedSeed;

                const existingPriority =
                  existing.priority ??
                  "normal";

                const requestedPriority =
                  request.body.priority ??
                  "normal";

                const sameRequest =
  existingMode === requestedMode &&
  existing.providerModelId === providerModelId &&
  existing.prompt === request.body.prompt &&
  existingImageInput === requestedImageInput &&
  existingDuration === requestedDuration &&
  existingEnhancePrompt === requestedEnhancePrompt &&
  sameSeed &&
  existingPriority === requestedPriority;

if (!sameRequest) {
  throw new GenerationRepositoryError(
    "Generation request idempotency key was already used with a different payload",
    "IDEMPOTENCY_CONFLICT",
  );
}

return {
  job: existing,
  replayed: true,
};              }              if (                request.body.organizationId              ) {                const accessResult =                  await tx                    .select({                      organizationId:                        organizations.id,                      ownerUserId:                        organizations.ownerUserId,                      membershipUserId:                        organizationMemberships.userId,                    })                    .from(organizations)                    .leftJoin(                      organizationMemberships,                      and(                        eq(                          organizationMemberships.organizationId,                          organizations.id,                        ),                        eq(                          organizationMemberships.userId,                          actor.userId,                        ),                      ),                    )                    .where(                      eq(                        organizations.id,                        request.body.organizationId,                      ),                    )                    .limit(1);                const access =                  accessResult[0];                if (                  !access ||                  (                    access.ownerUserId !==                      actor.userId &&                    access.membershipUserId !==                      actor.userId                  )                ) {                  throw new GenerationRepositoryError(                    "Generation request belongs to a different owner",                    "IDEMPOTENCY_CONFLICT",                  );                }              }              const hasImageAsset =
  typeof request.body.imageAssetId === "string" &&
  request.body.imageAssetId.length > 0;

const hasImageUrl =
  typeof request.body.imageUrl === "string" &&
  request.body.imageUrl.trim().length > 0;

let resolvedImageUrl: string | undefined;

if (mode === "text_to_video") {
  if (hasImageAsset || hasImageUrl) {
    throw new GenerationRepositoryError(
      "Text-to-video does not accept image input.",
      "INVALID_INPUT",
    );
  }
} else if (mode === "image_to_video") {
  if (hasImageAsset === hasImageUrl) {
    throw new GenerationRepositoryError(
      "Image-to-video requires exactly one image input.",
      "INVALID_INPUT",
    );
  }

  if (hasImageAsset) {
    const imageAssetId = request.body.imageAssetId!;

    const imageAssetResult = await tx
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, imageAssetId))
      .limit(1);

    const imageAsset = imageAssetResult[0];

    if (
      !imageAsset ||
      imageAsset.ownerUserId !== actor.userId ||
      imageAsset.type !== "image" ||
      imageAsset.status !== "ready" ||
      !imageAsset.storageKey
    ) {
      throw new GenerationRepositoryError(
        "Image asset was not found.",
        "NOT_FOUND",
      );
    }

    if (
      (imageAsset.organizationId ?? null) !==
      (request.body.organizationId ?? null)
    ) {
      throw new GenerationRepositoryError(
        "Image asset belongs to a different organization.",
        "IDEMPOTENCY_CONFLICT",
      );
    }

    const metadata = imageAsset.metadata;
    const metadataRecord =
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : null;

    const providerToken =
      metadataRecord &&
      typeof metadataRecord.providerToken === "string"
        ? metadataRecord.providerToken
        : null;

    if (
      !providerToken ||
      !/^[a-f0-9]{64}$/.test(providerToken)
    ) {
      throw new GenerationRepositoryError(
        "Image asset provider token is unavailable.",
        "INVALID_STATE",
      );
    }

    const publicBaseUrl =
      process.env.MEDIA_PUBLIC_BASE_URL
        ?.trim()
        .replace(/\/+$/, "");

    if (!publicBaseUrl) {
      throw new GenerationRepositoryError(
        "MEDIA_PUBLIC_BASE_URL is required for uploaded image generation.",
        "INVALID_STATE",
      );
    }

    let parsedBaseUrl: URL;

    try {
      parsedBaseUrl = new URL(publicBaseUrl);
    } catch {
      throw new GenerationRepositoryError(
        "MEDIA_PUBLIC_BASE_URL must be a valid absolute URL.",
        "INVALID_STATE",
      );
    }

    if (
      parsedBaseUrl.protocol !== "http:" &&
      parsedBaseUrl.protocol !== "https:"
    ) {
      throw new GenerationRepositoryError(
        "MEDIA_PUBLIC_BASE_URL must use http:// or https://.",
        "INVALID_STATE",
      );
    }

    resolvedImageUrl =
      `${publicBaseUrl}/api/v1/media/provider/${imageAsset.id}/${providerToken}`;
  } else {
    resolvedImageUrl = request.body.imageUrl!.trim();
  }
}

const quoteTime =                new Date();              const resolved =                await resolveGenerationPricingTx(                  tx,                  {                    providerModelId:                      providerModelId,                    unit: "second",                    currency: "INR",                    asOf: quoteTime,                  },                );              const quote =                calculateGenerationPrice({                  providerModelId:                    providerModelId,                  unit: "second",                  quantity:                    request.body.durationSeconds,                  pricing:                    resolved.pricing,                  policy:                    resolved.policy,                  asOf: quoteTime,                });              const creditOwner =                request.body.organizationId                  ? {                      organizationId:                        request.body.organizationId,                    }                  : {                      userId:                        actor.userId,                    };              const reservation =                await reserveCreditsTx(                  tx,                  {                    ...creditOwner,                    amount:                      quote.creditsRequired,                    idempotencyKey:                      "generation:" +                      request.body.requestId,                    referenceId:                      request.body.requestId,                  },                );              const providerInput = {
  mode,
  model: providerModelId,
  ...(resolvedImageUrl
    ? { imageUrl: resolvedImageUrl }
    : {}),
  ...(request.body.imageAssetId
    ? { imageAssetId: request.body.imageAssetId }
    : {}),
  duration: request.body.durationSeconds,
  ...(request.body.enhancePrompt !== undefined
    ? { enhance_prompt: request.body.enhancePrompt }
    : {}),
  ...(request.body.seed !== undefined
    ? { seed: request.body.seed }
    : {}),
};
const pricingSnapshot =                {                  pricingId:                    resolved.pricingId,                  policyId:                    resolved.policyId,                  quote,                };              const job =                await createGenerationJobTx(                  tx,                  {                    requestId:                      request.body.requestId,                    userId:                      actor.userId,                    ...(request.body                      .organizationId                      ? {                          organizationId:                            request.body                              .organizationId,                        }                      : {}),                    creditReservationId:                      reservation.id,                    type:                      "video",                    ...(request.body.priority !==                    undefined                      ? {                          priority:                            request.body.priority,                        }                      : {}),                    providerId:
                      mode === "text_to_video"
                        ? textToVideoProviderId
                        : "higgsfield",
                    providerModelId:
                      providerModelId,
                    prompt:
                      request.body.prompt,
                    input:
                      providerInput,
                    pricingSnapshot,
                  },
                );

              return {
                job,
                replayed: false,
                pricing: {
                  pricingVersion:
                    quote.pricingVersion,
                  currency:
                    quote.currency,
                  creditsRequired:
                    quote.creditsRequired,
                  customerChargeMinor:
                    quote.customerChargeMinor,
                },
              };
            },
          );

        return reply
          .code(
            result.replayed
              ? 200
              : 201,
          )
          .send({
            status: "ok",
            data: result,
          });
      } catch (error) {
        const mapped =
          mapGenerationError(error);

        if (mapped) {
          return reply
            .code(mapped.statusCode)
            .send({
              status: "error",
              code: mapped.code,
              message: mapped.message,
            });
        }

        throw error;
      }
    },
  );
/**   * GET /api/v1/generation/:jobId   *   * Customer-safe generation status read.   *   * Ownership is enforced by the generation repository.   * For organization-scoped jobs, the caller must provide   * the same organizationId context.   *   * Internal worker/provider/financial fields are deliberately   * excluded from the response.   */  app.get<{    Params: {      jobId: string;    };    Querystring: {      organizationId?: string;    };  }>(    "/:jobId",    {      schema: {        params:          GenerationJobIdParamsSchema,        querystring:          GenerationReadQuerySchema,      },    },    async (request, reply) => {      const actor = request.auth!;      const owner = {        userId: actor.userId,        ...(request.query.organizationId          ? {              organizationId:                request.query.organizationId,            }          : {}),      };      const job =        await getGenerationJob(          request.params.jobId,          owner,        );      if (!job) {        return reply.code(404).send({          status: "error",          code: "NOT_FOUND",          message:            "Generation job not found",        });      }      return reply.send({        status: "ok",        data:          toCustomerGenerationJob(job),      });    },  );  /**   * GET /api/v1/generation/:jobId/output   *   * Customer-safe generation output read.   *   * The generation job is authorized first. Outputs are   * never queried by jobId alone from the customer boundary.   */  app.get<{    Params: {      jobId: string;    };    Querystring: {      organizationId?: string;    };  }>(    "/:jobId/output",    {      schema: {        params:          GenerationJobIdParamsSchema,        querystring:          GenerationReadQuerySchema,      },    },    async (request, reply) => {      const actor =        request.auth!;      const owner = {        userId:          actor.userId,        ...(request.query.organizationId          ? {              organizationId:                request.query.organizationId,            }          : {}),      };      const job =        await getGenerationJob(          request.params.jobId,          owner,        );      if (!job) {        return reply.code(404).send({          status: "error",          code: "NOT_FOUND",          message:            "Generation job not found",        });      }      const outputs =        await listGenerationOutputs(          job.id,        );      return reply.send({        status: "ok",        data: outputs.map(          (output) => ({            id:              output.id,            type:              output.type,            url:              `/api/v1/generation/${job.id}/output/${output.id}`,            mimeType:              output.mimeType,            sizeBytes:              output.sizeBytes,            createdAt:              output.createdAt.toISOString(),          }),        ),      });    },  );  app.get<{    Params: {      jobId: string;      outputId: string;    };    Querystring: {      organizationId?: string;    };  }>(    "/:jobId/output/:outputId",    {      preHandler: authenticate,      schema: {        params:          GenerationOutputParamsSchema,        querystring:          GenerationReadQuerySchema,      },    },    async (request, reply) => {      const actor =        request.auth!;      const owner = {        userId:          actor.userId,        ...(request.query.organizationId          ? {              organizationId:                request.query.organizationId,            }          : {}),      };      const job =        await getGenerationJob(          request.params.jobId,          owner,        );      if (!job) {        return reply.code(404).send({          status: "error",          code: "NOT_FOUND",          message:            "Generation job not found",        });      }      const outputResult =        await db          .select({            id:              generationOutputs.id,            artifactId:              generationOutputs.artifactId,            mimeType:              generationOutputs.mimeType,            storageKey:              artifacts.storageKey,            ownerUserId:              artifacts.ownerUserId,            organizationId:              artifacts.organizationId,          })          .from(            generationOutputs,          )          .innerJoin(            artifacts,            eq(              artifacts.id,              generationOutputs.artifactId,            ),          )          .where(            and(              eq(                generationOutputs.id,                request.params.outputId,              ),              eq(                generationOutputs.jobId,                job.id,              ),              eq(                artifacts.ownerUserId,                actor.userId,              ),              request.query.organizationId                ? eq(                    artifacts.organizationId,                    request.query.organizationId,                  )                : isNull(                    artifacts.organizationId,                  ),            ),          )          .limit(1);      const output =        outputResult[0];      if (        !output ||        !output.storageKey      ) {        return reply.code(404).send({          status: "error",          code: "NOT_FOUND",          message:            "Generation output not found",        });      }      const storageRoot =        process.env.MEDIA_STORAGE_ROOT?.trim() ||        resolve(          process.cwd(),          "..",          "worker",          "worker-storage",        );      const storage =        new LocalMediaStorage({          rootDirectory:            storageRoot,        });      try {        const media =          await storage.openFile(            output.storageKey,          );        const mimeType =          output.mimeType?.trim() ||          "application/octet-stream";        return reply          .type(mimeType)          .header(            "Content-Length",            String(media.sizeBytes),          )          .header(            "Content-Disposition",            'inline; filename="Generated Video.mp4"',          )          .header(            "Cache-Control",            "private, no-store",          )          .send(            media.stream,          );      } catch (error) {        if (          error instanceof MediaStorageError        ) {          return reply.code(404).send({            status: "error",            code: "OUTPUT_NOT_FOUND",            message:              "Generation output file not found",          });        }        throw error;      }    },  );  /**   * POST /api/v1/generation/:jobId/cancel   *   * Cancellation and reservation release occur in one   * PostgreSQL transaction.   */  app.post<{
    Params: {
      jobId: string;
    };
  }>(
    "/:jobId/cancel",
    {
      schema: {
        params:
          GenerationJobIdParamsSchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth!;

      try {
        const result =
          await db.transaction(
            async (tx) => {
              const jobResult =
                await tx
                  .select()
                  .from(generationJobs)
                  .where(
                    and(
                      eq(
                        generationJobs.id,
                        request.params.jobId,
                      ),
                      eq(
                        generationJobs.userId,
                        actor.userId,
                      ),
                    ),
                  )
                  .for("update")
                  .limit(1);

              const job =
                jobResult[0];

              if (!job) {
                throw new GenerationRepositoryError(
                  "Generation job not found",
                  "NOT_FOUND",
                );
              }

              /*
               * Organization jobs require current membership/access.
               * Individual jobs are creator-owned.
               */
              if (job.organizationId) {
                const accessResult =
                  await tx
                    .select({
                      organizationId:
                        organizations.id,
                      ownerUserId:
                        organizations.ownerUserId,
                      membershipUserId:
                        organizationMemberships.userId,
                    })
                    .from(organizations)
                    .leftJoin(
                      organizationMemberships,
                      and(
                        eq(
                          organizationMemberships.organizationId,
                          organizations.id,
                        ),
                        eq(
                          organizationMemberships.userId,
                          actor.userId,
                        ),
                      ),
                    )
                    .where(
                      eq(
                        organizations.id,
                        job.organizationId,
                      ),
                    )
                    .limit(1);

                const access =
                  accessResult[0];

                if (
                  !access ||
                  (
                    access.ownerUserId !==
                      actor.userId &&
                    access.membershipUserId !==
                      actor.userId
                  )
                ) {
                  throw new GenerationRepositoryError(
                    "Generation job not found",
                    "NOT_FOUND",
                  );
                }
              }

              /*
               * Serialize cancellation attempts for the same
               * generation request within PostgreSQL.
               *
               * Settlement will acquire the same key in its
               * final concurrency hardening gate.
               */
              await tx.execute(
                sql`
                  select pg_advisory_xact_lock(
                    hashtextextended(
                      ${job.requestId},
                      0
                    )
                  )
                `,
              );

              const owner = {
                userId:
                  actor.userId,
                ...(job.organizationId
                  ? {
                      organizationId:
                        job.organizationId,
                    }
                  : {}),
              };

              const creditOwner =
                job.organizationId
                  ? {
                      organizationId:
                        job.organizationId,
                    }
                  : {
                      userId:
                        actor.userId,
                    };

              const cancelled =
                await cancelGenerationJobTx(
                  tx,
                  job.id,
                  owner,
                );

              await releaseReservationTx(
                tx,
                cancelled.creditReservationId,
                `cancel:${cancelled.requestId}`,
                creditOwner,
              );

              return cancelled;
            },
          );

        return {
          status: "ok",
          data: result,
        };
      } catch (error) {
        const mapped =
          mapGenerationError(error);

        if (mapped) {
          return reply
            .code(mapped.statusCode)
            .send({
              status: "error",
              code: mapped.code,
              message: mapped.message,
            });
        }

        throw error;
      }
    },
  );
}
