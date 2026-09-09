import {
  and,
  asc,
  eq,
  gte,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";

import {
  db,
  generationJobs,
  generationOutputs,
} from "@ak-vision-ai/database";

export type GenerationRepositoryErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE"
  | "LEASE_CONFLICT";

export class GenerationRepositoryError
  extends Error {
  constructor(
    message: string,
    public readonly code: GenerationRepositoryErrorCode,
  ) {
    super(message);
    this.name =
      "GenerationRepositoryError";
  }
}

export type GenerationOwner = {
  userId: string;
  organizationId?: string;
};

export type CreateGenerationJobInput = {
  id?: string;
  requestId: string;
  userId: string;
  organizationId?: string;
  projectId?: string;
  conversationId?: string;
  creditReservationId: string;

  type:
    | "image"
    | "video"
    | "audio"
    | "speech"
    | "music"
    | "document"
    | "spreadsheet"
    | "presentation";

  priority?:
    | "low"
    | "normal"
    | "high";

  providerId?: string;
  providerModelId?: string;
  prompt?: string;
  input?: Record<string, unknown>;
  pricingSnapshot?: Record<string, unknown>;
  maxAttempts?: number;
};

function assertOwner(
  owner: GenerationOwner,
): void {
  if (!owner.userId) {
    throw new GenerationRepositoryError(
      "Generation owner userId is required",
      "INVALID_INPUT",
    );
  }
}

function ownerMatches(
  row: {
    userId: string;
    organizationId: string | null;
  },
  owner: GenerationOwner,
): boolean {
  return (
    row.userId === owner.userId &&
    (row.organizationId ?? null) ===
      (owner.organizationId ?? null)
  );
}

function validatePositiveInteger(
  value: number,
  field: string,
): void {
  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new GenerationRepositoryError(
      `${field} must be a positive integer`,
      "INVALID_INPUT",
    );
  }
}

/**
 * Create/recover a generation job by requestId.
 *
 * requestId is the generation idempotency boundary.
 */
export async function createGenerationJobTx(
  tx: GenerationTransaction,

  input: CreateGenerationJobInput,
) {
  if (!input.requestId) {
    throw new GenerationRepositoryError(
      "requestId is required",
      "INVALID_INPUT",
    );
  }

  if (!input.userId) {
    throw new GenerationRepositoryError(
      "userId is required",
      "INVALID_INPUT",
    );
  }

  if (!input.creditReservationId) {
    throw new GenerationRepositoryError(
      "creditReservationId is required",
      "INVALID_INPUT",
    );
  }

  if (
    input.maxAttempts !== undefined
  ) {
    validatePositiveInteger(
      input.maxAttempts,
      "maxAttempts",
    );
  }

  const owner: GenerationOwner = {
    userId: input.userId,
    ...(input.organizationId !== undefined
      ? {
          organizationId:
            input.organizationId,
        }
      : {}),
  };

  const existing =
    await tx
      .select()
      .from(generationJobs)
      .where(
        eq(
          generationJobs.requestId,
          input.requestId,
        ),
      )
      .limit(1);

  if (existing[0]) {
    if (
      !ownerMatches(
        existing[0],
        owner,
      )
    ) {
      throw new GenerationRepositoryError(
        "Generation request belongs to a different owner",
        "IDEMPOTENCY_CONFLICT",
      );
    }

    return existing[0];
  }

  const result =
    await tx
      .insert(generationJobs)
      .values({
        ...(input.id !== undefined
          ? { id: input.id }
          : {}),
        requestId:
          input.requestId,
        userId:
          input.userId,
        organizationId:
          input.organizationId,
        projectId:
          input.projectId,
        conversationId:
          input.conversationId,
        creditReservationId:
          input.creditReservationId,
        type:
          input.type,
        ...(input.priority !== undefined
          ? {
              priority:
                input.priority,
            }
          : {}),
        providerId:
          input.providerId,
        providerModelId:
          input.providerModelId,
        prompt:
          input.prompt,
        input:
          input.input,
        pricingSnapshot:
          input.pricingSnapshot,
        ...(input.maxAttempts !== undefined
          ? {
              maxAttempts:
                input.maxAttempts,
            }
          : {}),
      })
      .onConflictDoNothing({
        target:
          generationJobs.requestId,
      })
      .returning();

  if (result[0]) {
    return result[0];
  }

  const recovered =
    await tx
      .select()
      .from(generationJobs)
      .where(
        eq(
          generationJobs.requestId,
          input.requestId,
        ),
      )
      .limit(1);

  if (!recovered[0]) {
    throw new GenerationRepositoryError(
      "Generation job could not be created or recovered",
      "NOT_FOUND",
    );
  }

  if (
    !ownerMatches(
      recovered[0],
      owner,
    )
  ) {
    throw new GenerationRepositoryError(
      "Generation request belongs to a different owner",
      "IDEMPOTENCY_CONFLICT",
    );
  }

  return recovered[0];
}


/**
 * Create/recover a generation job in its own transaction.
 */
export async function createGenerationJob(
  input: CreateGenerationJobInput,
) {
  return db.transaction(
    async (tx) =>
      createGenerationJobTx(
        tx,
        input,
      ),
  );
}
export async function getGenerationJob(
  jobId: string,
  owner: GenerationOwner,
) {
  assertOwner(owner);

  const result =
    await db
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(
            generationJobs.id,
            jobId,
          ),
          eq(
            generationJobs.userId,
            owner.userId,
          ),
          owner.organizationId !== undefined
            ? eq(
                generationJobs.organizationId,
                owner.organizationId,
              )
            : isNull(
                generationJobs.organizationId,
              ),
        ),
      )
      .limit(1);

  return result[0] ?? null;
}

/**
 * Recover jobs whose processing lease expired after
 * their final allowed attempt.
 *
 * Without this transition a crashed worker could leave
 * a final-attempt job permanently stuck in processing.
 */
async function recoverExhaustedLeasesTx(
  tx: Parameters<
    Parameters<typeof db.transaction>[0]
  >[0],
) {
  const now = new Date();

  await tx
    .update(generationJobs)
    .set({
      status: "failed",
      errorCode:
        "MAX_ATTEMPTS_EXHAUSTED",
      errorMessage:
        "Worker lease expired after the maximum number of attempts.",
      completedAt: now,
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(
          generationJobs.status,
          "processing",
        ),
        lte(
          generationJobs.leaseExpiresAt,
          now,
        ),
        sql`${generationJobs.attemptCount} >= ${generationJobs.maxAttempts}`,
      ),
    );
}

/**
 * Claim one generation job.
 *
 * Queued jobs and recoverable expired processing jobs
 * compete for the same worker claim path.
 *
 * PostgreSQL FOR UPDATE SKIP LOCKED ensures concurrent
 * workers do not claim the same row.
 */
export async function claimNextGenerationJob(
  workerId: string,
  leaseMs: number = 60_000,
) {
  if (!workerId) {
    throw new GenerationRepositoryError(
      "workerId is required",
      "INVALID_INPUT",
    );
  }

  validatePositiveInteger(
    leaseMs,
    "leaseMs",
  );

  return db.transaction(
    async (tx) => {
      const now = new Date();

      await recoverExhaustedLeasesTx(
        tx,
      );

      const candidates =
        await tx
          .select()
          .from(generationJobs)
          .where(
            or(
              and(
                eq(
                  generationJobs.status,
                  "queued",
                ),
                or(
                  isNull(
                    generationJobs.nextAttemptAt,
                  ),
                  lte(
                    generationJobs.nextAttemptAt,
                    now,
                  ),
                ),
                lt(
                  generationJobs.attemptCount,
                  generationJobs.maxAttempts,
                ),
              ),
              and(
                eq(
                  generationJobs.status,
                  "processing",
                ),
                lte(
                  generationJobs.leaseExpiresAt,
                  now,
                ),
                lt(
                  generationJobs.attemptCount,
                  generationJobs.maxAttempts,
                ),
              ),
            ),
          )
          .orderBy(
            sql`
              CASE
                WHEN ${generationJobs.priority} = 'high'
                  THEN 0
                WHEN ${generationJobs.priority} = 'normal'
                  THEN 1
                ELSE 2
              END
            `,
            asc(
              generationJobs.createdAt,
            ),
          )
          .for("update", {
            skipLocked: true,
          })
          .limit(1);

      const job =
        candidates[0];

      if (!job) {
        return null;
      }

      const leaseExpiresAt =
        new Date(
          now.getTime() + leaseMs,
        );

      const updated =
        await tx
          .update(generationJobs)
          .set({
            status: "processing",
            attemptCount:
              sql`${generationJobs.attemptCount} + 1`,
            startedAt:
              job.startedAt ?? now,
            errorCode: null,
            errorMessage: null,
            nextAttemptAt: null,
            lockedAt: now,
            lockedBy:
              workerId,
            leaseExpiresAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(
                generationJobs.id,
                job.id,
              ),
              job.status === "queued"
                ? eq(
                    generationJobs.status,
                    "queued",
                  )
                : and(
                    eq(
                      generationJobs.status,
                      "processing",
                    ),
                    lte(
                      generationJobs.leaseExpiresAt,
                      now,
                    ),
                  ),
            ),
          )
          .returning();

      return updated[0] ?? null;
    },
  );
}

export async function heartbeatGenerationJob(
  jobId: string,
  workerId: string,
  leaseMs: number = 60_000,
) {
  validatePositiveInteger(
    leaseMs,
    "leaseMs",
  );

  const now = new Date();

  const result =
    await db
      .update(generationJobs)
      .set({
        leaseExpiresAt:
          new Date(
            now.getTime() + leaseMs,
          ),
        updatedAt: now,
      })
      .where(
        and(
          eq(
            generationJobs.id,
            jobId,
          ),
          eq(
            generationJobs.status,
            "processing",
          ),
          eq(
            generationJobs.lockedBy,
            workerId,
          ),
          gte(
            generationJobs.leaseExpiresAt,
            now,
          ),
        ),
      )
      .returning();

  if (!result[0]) {
    throw new GenerationRepositoryError(
      "Generation job lease could not be renewed",
      "LEASE_CONFLICT",
    );
  }

  return result[0];
}

export async function setGenerationProviderRequest(
  jobId: string,
  workerId: string,
  providerId: string,
  providerRequestId: string,
) {
  if (!jobId) {
    throw new GenerationRepositoryError(
      "jobId is required",
      "INVALID_INPUT",
    );
  }

  if (!workerId) {
    throw new GenerationRepositoryError(
      "workerId is required",
      "INVALID_INPUT",
    );
  }

  const normalizedProviderId =
    providerId.trim();

  if (!normalizedProviderId) {
    throw new GenerationRepositoryError(
      "providerId is required",
      "INVALID_INPUT",
    );
  }

  if (normalizedProviderId.length > 100) {
    throw new GenerationRepositoryError(
      "providerId must be 100 characters or less",
      "INVALID_INPUT",
    );
  }

  const normalizedProviderRequestId =
    providerRequestId.trim();

  if (!normalizedProviderRequestId) {
    throw new GenerationRepositoryError(
      "providerRequestId is required",
      "INVALID_INPUT",
    );
  }

  if (
    normalizedProviderRequestId.length >
    255
  ) {
    throw new GenerationRepositoryError(
      "providerRequestId must be 255 characters or less",
      "INVALID_INPUT",
    );
  }

  const now = new Date();

  try {
    const result =
      await db
        .update(generationJobs)
        .set({
          providerId:
            normalizedProviderId,
          providerRequestId:
            normalizedProviderRequestId,
          updatedAt: now,
        })
        .where(
          and(
            eq(
              generationJobs.id,
              jobId,
            ),
            eq(
              generationJobs.status,
              "processing",
            ),
            eq(
              generationJobs.lockedBy,
              workerId,
            ),
            gte(
              generationJobs.leaseExpiresAt,
              now,
            ),
            isNull(
              generationJobs.providerRequestId,
            ),
          ),
        )
        .returning();

    if (result[0]) {
      return result[0];
    }
  } catch (error) {
    const wrappedError =
      error as {
        code?: unknown;
        constraint?: unknown;
        cause?: unknown;
      };

    const cause =
      wrappedError.cause as {
        code?: unknown;
        constraint?: unknown;
      } | undefined;

    const postgresCode =
      wrappedError.code ??
      cause?.code;

    const postgresConstraint =
      wrappedError.constraint ??
      cause?.constraint;

    if (
      postgresCode === "23505" &&
      postgresConstraint ===
        "generation_jobs_provider_request_unique"
    ) {
      throw new GenerationRepositoryError(
        "Provider request is already assigned to another generation job",
        "IDEMPOTENCY_CONFLICT",
      );
    }

    throw error;
  }

  const current =
    await db
      .select({
        id: generationJobs.id,
        status:
          generationJobs.status,
        lockedBy:
          generationJobs.lockedBy,
        leaseExpiresAt:
          generationJobs.leaseExpiresAt,
        providerId:
          generationJobs.providerId,
        providerRequestId:
          generationJobs.providerRequestId,
      })
      .from(generationJobs)
      .where(
        eq(
          generationJobs.id,
          jobId,
        ),
      )
      .limit(1);

  const currentJob =
    current[0];

  if (!currentJob) {
    throw new GenerationRepositoryError(
      "Generation job not found",
      "NOT_FOUND",
    );
  }

  if (
    currentJob.status !==
      "processing" ||
    currentJob.lockedBy !==
      workerId ||
    !currentJob.leaseExpiresAt ||
    currentJob.leaseExpiresAt.getTime() <
      now.getTime()
  ) {
    throw new GenerationRepositoryError(
      "Generation job lease is no longer owned by this worker",
      "LEASE_CONFLICT",
    );
  }

  if (
    currentJob.providerId ===
      normalizedProviderId &&
    currentJob.providerRequestId ===
      normalizedProviderRequestId
  ) {
    return currentJob;
  }

  if (
    currentJob.providerRequestId
  ) {
    throw new GenerationRepositoryError(
      "Generation provider request is already assigned",
      "INVALID_STATE",
    );
  }

  throw new GenerationRepositoryError(
    "Generation provider request could not be persisted",
    "INVALID_STATE",
  );
}
export async function updateGenerationProgress(
  jobId: string,
  workerId: string,
  progress: number,
) {
  const now = new Date();

  if (
    !Number.isInteger(progress) ||
    progress < 0 ||
    progress > 99
  ) {
  const now = new Date();

    throw new GenerationRepositoryError(
      "Progress must be an integer between 0 and 99",
      "INVALID_INPUT",
    );
  }

  const result =
    await db
      .update(generationJobs)
      .set({
        progress,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            generationJobs.id,
            jobId,
          ),
          eq(
            generationJobs.status,
            "processing",
          ),
          eq(
            generationJobs.lockedBy,
            workerId,
          ),
          gte(
            generationJobs.leaseExpiresAt,
            now,
          ),
        ),
      )
      .returning();

  if (!result[0]) {
    throw new GenerationRepositoryError(
      "Generation progress update rejected",
      "LEASE_CONFLICT",
    );
  }

  return result[0];
}

export async function completeGenerationJob(
  jobId: string,
  workerId: string,
  output: Record<string, unknown>,
) {
  const now = new Date();

  const result =
    await db
      .update(generationJobs)
      .set({
        status: "completed",
        progress: 100,
        output,
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            generationJobs.id,
            jobId,
          ),
          eq(
            generationJobs.status,
            "processing",
          ),
          eq(
            generationJobs.lockedBy,
            workerId,
        ),
          gte(
            generationJobs.leaseExpiresAt,
            now,
          ),
        ),
      )
      .returning();

  if (!result[0]) {
    throw new GenerationRepositoryError(
      "Generation job could not be completed",
      "LEASE_CONFLICT",
    );
  }

  return result[0];
}

export async function failGenerationJob(
  jobId: string,
  workerId: string,
  input: {
    errorCode: string;
    errorMessage: string;
    retryDelayMs?: number;
    retryable?: boolean;
  },
) {
  const now = new Date();

  const current =
    await db
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(
            generationJobs.id,
            jobId,
          ),
          eq(
            generationJobs.status,
            "processing",
          ),
          eq(
            generationJobs.lockedBy,
            workerId,
          ),
          gte(
            generationJobs.leaseExpiresAt,
            now,
          ),
        ),
      )
      .limit(1);

  const job =
    current[0];

  if (!job) {
    throw new GenerationRepositoryError(
      "Generation job is not owned by this worker",
      "LEASE_CONFLICT",
    );
  }

  const retryable = (input.retryable ?? true) && job.attemptCount < job.maxAttempts;
const retryDelayMs =
    input.retryDelayMs ??
    Math.min(
      60_000,
      1_000 *
        2 **
          Math.max(
            0,
            job.attemptCount - 1,
          ),
    );

  if (
    !Number.isInteger(
      retryDelayMs,
    ) ||
    retryDelayMs < 0
  ) {
    throw new GenerationRepositoryError(
      "retryDelayMs must be a non-negative integer",
      "INVALID_INPUT",
    );
  }

  const nextAttemptAt =
    new Date(
      now.getTime() +
        retryDelayMs,
    );

  const values = retryable
    ? {
        status:
          "queued" as const,
        errorCode:
          input.errorCode,
        errorMessage:
          input.errorMessage,
        nextAttemptAt,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        updatedAt: now,
      }
    : {
        status:
          "failed" as const,
        errorCode:
          input.errorCode,
        errorMessage:
          input.errorMessage,
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        updatedAt: now,
      };

  const result =
    await db
      .update(generationJobs)
      .set(values)
      .where(
        and(
          eq(
            generationJobs.id,
            jobId,
          ),
          eq(
            generationJobs.status,
            "processing",
          ),
          eq(
            generationJobs.lockedBy,
            workerId,
          ),
          gte(
            generationJobs.leaseExpiresAt,
            now,
          ),
        ),
      )
      .returning();

  if (!result[0]) {
    throw new GenerationRepositoryError(
      "Generation failure transition could not be committed",
      "LEASE_CONFLICT",
    );
  }

  return result[0];
}

export type GenerationTransaction =
  Parameters<
    Parameters<typeof db.transaction>[0]
  >[0];

export async function cancelGenerationJobTx(
  tx: GenerationTransaction,
  jobId: string,
  owner: GenerationOwner,
) {
  assertOwner(owner);

  const now = new Date();

  const result =
    await tx
      .update(generationJobs)
      .set({
        status: "cancelled",
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            generationJobs.id,
            jobId,
          ),
          eq(
            generationJobs.userId,
            owner.userId,
          ),
          owner.organizationId !== undefined
            ? eq(
                generationJobs.organizationId,
                owner.organizationId,
              )
            : isNull(
                generationJobs.organizationId,
              ),
          or(
            eq(
              generationJobs.status,
              "queued",
            ),
            eq(
              generationJobs.status,
              "processing",
            ),
          ),
        ),
      )
      .returning();

  if (!result[0]) {
    throw new GenerationRepositoryError(
      "Generation job cannot be cancelled from its current state",
      "INVALID_STATE",
    );
  }

  return result[0];
}

/**
 * Cancel a generation job in its own transaction.
 *
 * Cross-domain callers that also need to release credits should
 * use cancelGenerationJobTx() inside their transaction.
 */
export async function cancelGenerationJob(
  jobId: string,
  owner: GenerationOwner,
) {
  return db.transaction(
    async (tx) =>
      cancelGenerationJobTx(
        tx,
        jobId,
        owner,
      ),
  );
}
export async function createGenerationOutput(
  input: {
    jobId: string;
    type:
      | "image"
      | "video"
      | "audio"
      | "speech"
      | "music"
      | "document"
      | "spreadsheet"
      | "presentation";
    url: string;
    mimeType: string;
    sizeBytes?: number;
    metadata?: Record<string, unknown>;
    idempotencyKey: string;
  },
) {
  if (!input.jobId) {
    throw new GenerationRepositoryError(
      "jobId is required",
      "INVALID_INPUT",
    );
  }

  if (!input.url) {
    throw new GenerationRepositoryError(
      "Generation output URL is required",
      "INVALID_INPUT",
    );
  }

  const idempotencyKey =
    input.idempotencyKey?.trim();

  if (!idempotencyKey) {
    throw new GenerationRepositoryError(
      "idempotencyKey is required",
      "INVALID_INPUT",
    );
  }

  if (
    input.sizeBytes !== undefined &&
    (!Number.isInteger(
      input.sizeBytes,
    ) ||
      input.sizeBytes < 0)
  ) {
    throw new GenerationRepositoryError(
      "sizeBytes must be a non-negative integer",
      "INVALID_INPUT",
    );
  }

  /*
   * Canonical JSON serialization makes metadata comparison
   * deterministic even when object key insertion order differs.
   */
  const canonicalize = (
    value: unknown,
  ): unknown => {
    if (Array.isArray(value)) {
      return value.map(
        canonicalize,
      );
    }

    if (
      value !== null &&
      typeof value === "object"
    ) {
      return Object.fromEntries(
        Object.entries(
          value as Record<string, unknown>,
        )
          .sort(([left], [right]) =>
            left.localeCompare(right),
          )
          .map(
            ([key, child]) => [
              key,
              canonicalize(child),
            ],
          ),
      );
    }

    return value;
  };

  const samePayload = (
    existing: {
      type: string;
      url: string;
      mimeType: string;
      sizeBytes: number | null;
      metadata: unknown;
    },
  ): boolean => {
    return (
      existing.type === input.type &&
      existing.url === input.url &&
      existing.mimeType ===
        input.mimeType &&
      (existing.sizeBytes ?? null) ===
        (input.sizeBytes ?? null) &&
      JSON.stringify(
        canonicalize(
          existing.metadata ?? null,
        ),
      ) ===
        JSON.stringify(
          canonicalize(
            input.metadata ?? null,
          ),
        )
    );
  };

  /*
   * First writer wins at the database level through the
   * unique(job_id, idempotency_key) constraint.
   */
  const inserted =
    await db
      .insert(generationOutputs)
      .values({
        jobId:
          input.jobId,
        type:
          input.type,
        url:
          input.url,
        mimeType:
          input.mimeType,
        sizeBytes:
          input.sizeBytes,
        metadata:
          input.metadata,
        idempotencyKey,
      })
      .onConflictDoNothing({
        target: [
          generationOutputs.jobId,
          generationOutputs.idempotencyKey,
        ],
      })
      .returning();

  const created =
    inserted[0];

  if (created) {
    return created;
  }

  /*
   * A conflicting insert means another request already
   * committed this (jobId, idempotencyKey).
   */
  const existingResult =
    await db
      .select()
      .from(generationOutputs)
      .where(
        and(
          eq(
            generationOutputs.jobId,
            input.jobId,
          ),
          eq(
            generationOutputs.idempotencyKey,
            idempotencyKey,
          ),
        ),
      )
      .limit(1);

  const existing =
    existingResult[0];

  if (!existing) {
    /*
     * The conflict disappeared before recovery. Treat that as
     * a repository failure rather than returning an incorrect
     * success.
     */
    throw new GenerationRepositoryError(
      "Generation output could not be recovered after an idempotent conflict",
      "NOT_FOUND",
    );
  }

  if (
    !samePayload(existing)
  ) {
    throw new GenerationRepositoryError(
      "Generation output idempotency key was already used with a different payload",
      "IDEMPOTENCY_CONFLICT",
    );
  }

  return existing;
}
export async function listGenerationOutputs(
  jobId: string,
) {
  return db
    .select()
    .from(generationOutputs)
    .where(
      eq(
        generationOutputs.jobId,
        jobId,
      ),
    )
    .orderBy(
      asc(
        generationOutputs.createdAt,
      ),
    );
}










