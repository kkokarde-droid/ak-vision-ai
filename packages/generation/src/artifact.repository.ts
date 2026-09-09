import {
  and,
  eq,
  isNull,
} from "drizzle-orm";

import {
  artifacts,
  artifactVersions,
  db,
  generationJobs,
  generationOutputs,
} from "@ak-vision-ai/database";

export class ArtifactRepositoryError
  extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "OWNERSHIP_CONFLICT"
      | "PERSISTENCE_FAILED",
  ) {
    super(message);
    this.name =
      "ArtifactRepositoryError";
  }
}

export interface PersistGenerationArtifactInput {
  jobId: string;
  storageKey: string;
  storageUrl: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface PersistGenerationArtifactResult {
  artifact: typeof artifacts.$inferSelect;
  artifactVersion:
    typeof artifactVersions.$inferSelect;
  generationOutput:
    typeof generationOutputs.$inferSelect;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function sameNullableNumber(
  left: number | null,
  right: number | undefined,
): boolean {
  return right === undefined
    ? left === null
    : left === right;
}

function sameOutputPayload(
  existing:
    typeof generationOutputs.$inferSelect,
  expected: {
    jobId: string;
    artifactId: string;
    type: typeof generationOutputs.$inferSelect.type;
    url: string;
    mimeType: string;
    sizeBytes?: number;
  },
): boolean {
  return (
    existing.jobId === expected.jobId &&
    existing.artifactId ===
      expected.artifactId &&
    existing.type === expected.type &&
    existing.url === expected.url &&
    existing.mimeType ===
      expected.mimeType &&
    sameNullableNumber(
      existing.sizeBytes,
      expected.sizeBytes,
    )
  );
}

function generationArtifactMetadata(
  jobId: string,
  inputMetadata?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(inputMetadata ?? {}),
    generationJobId: jobId,
  };
}

export async function persistGenerationArtifact(
  input: PersistGenerationArtifactInput,
): Promise<PersistGenerationArtifactResult> {
  if (!input.jobId.trim()) {
    throw new ArtifactRepositoryError(
      "Generation job id is required.",
      "PERSISTENCE_FAILED",
    );
  }

  if (!input.storageKey.trim()) {
    throw new ArtifactRepositoryError(
      "Artifact storage key is required.",
      "PERSISTENCE_FAILED",
    );
  }

  if (!input.storageUrl.trim()) {
    throw new ArtifactRepositoryError(
      "Artifact storage URL is required.",
      "PERSISTENCE_FAILED",
    );
  }

  if (!input.name.trim()) {
    throw new ArtifactRepositoryError(
      "Artifact name is required.",
      "PERSISTENCE_FAILED",
    );
  }

  if (!input.mimeType.trim()) {
    throw new ArtifactRepositoryError(
      "Artifact MIME type is required.",
      "PERSISTENCE_FAILED",
    );
  }

  if (
    input.sizeBytes !== undefined &&
    (
      !Number.isInteger(
        input.sizeBytes,
      ) ||
      input.sizeBytes < 0
    )
  ) {
    throw new ArtifactRepositoryError(
      "Artifact size must be a non-negative integer.",
      "PERSISTENCE_FAILED",
    );
  }

  return db.transaction(
    async (tx) => {
      /*
       * Resolve the owning generation job first.
       * Ownership is never supplied independently by the caller.
       */
      const jobResult =
        await tx
          .select()
          .from(generationJobs)
          .where(
            eq(
              generationJobs.id,
              input.jobId,
            ),
          )
          .limit(1);

      const job =
        jobResult[0];

      if (!job) {
        throw new ArtifactRepositoryError(
          "Generation job not found.",
          "NOT_FOUND",
        );
      }

      /*
       * The generation output idempotency key is deterministic.
       * Read it before creating an artifact to prevent creating
       * an orphan artifact when a completed output already exists.
       */
      const idempotencyKey =
        `generation-output:${job.id}`;

      const existingOutputResult =
        await tx
          .select()
          .from(generationOutputs)
          .where(
            and(
              eq(
                generationOutputs.jobId,
                job.id,
              ),
              eq(
                generationOutputs.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);

      const existingOutput =
        existingOutputResult[0];

      if (
        existingOutput?.artifactId
      ) {
        const artifactResult =
          await tx
            .select()
            .from(artifacts)
            .where(
              eq(
                artifacts.id,
                existingOutput.artifactId,
              ),
            )
            .limit(1);

        const existingArtifact =
          artifactResult[0];

        if (!existingArtifact) {
          throw new ArtifactRepositoryError(
            "Generation output references a missing artifact.",
            "PERSISTENCE_FAILED",
          );
        }

        if (
          existingArtifact.storageKey !==
          input.storageKey
        ) {
          throw new ArtifactRepositoryError(
            "Generation output idempotency key conflicts with a different artifact storage key.",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        if (
          existingArtifact.ownerUserId !==
          job.userId ||
          (
            existingArtifact.organizationId ??
            null
          ) !==
            (
              job.organizationId ??
              null
            )
        ) {
          throw new ArtifactRepositoryError(
            "Artifact ownership does not match the generation job owner.",
            "OWNERSHIP_CONFLICT",
          );
        }

        const versionResult =
          await tx
            .select()
            .from(artifactVersions)
            .where(
              and(
                eq(
                  artifactVersions.artifactId,
                  existingArtifact.id,
                ),
                eq(
                  artifactVersions.version,
                  existingArtifact.version,
                ),
              ),
            )
            .limit(1);

        const existingVersion =
          versionResult[0];

        if (!existingVersion) {
          throw new ArtifactRepositoryError(
            "Artifact version is missing.",
            "PERSISTENCE_FAILED",
          );
        }

        if (
          !sameOutputPayload(
            existingOutput,
            {
              jobId:
                job.id,
              artifactId:
                existingArtifact.id,
              type:
                job.type,
              url:
                input.storageUrl,
              mimeType:
                input.mimeType,
              ...(input.sizeBytes !== undefined
                ? {
                    sizeBytes:
                      input.sizeBytes,
                  }
                : {}),
            },
          )
        ) {
          throw new ArtifactRepositoryError(
            "Generation output idempotency key was already used with a different payload.",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        return {
          artifact:
            existingArtifact,
          artifactVersion:
            existingVersion,
          generationOutput:
            existingOutput,
        };
      }

      /*
       * Artifact identity is deterministic through storageKey.
       * The unique index protects concurrent writers.
       */
      const insertedArtifact =
        await tx
          .insert(artifacts)
          .values({
            ownerUserId:
              job.userId,
            ...(job.organizationId
              ? {
                  organizationId:
                    job.organizationId,
                }
              : {}),
            ...(job.projectId
              ? {
                  projectId:
                    job.projectId,
                }
              : {}),
            ...(job.conversationId
              ? {
                  conversationId:
                    job.conversationId,
                }
              : {}),
            name:
              input.name,
            storageKey:
              input.storageKey,
            type:
              "video",
            status:
              "ready",
            version:
              1,
            mimeType:
              input.mimeType,
            sizeBytes:
              input.sizeBytes,
            storageUrl:
              input.storageUrl,
            metadata:
              generationArtifactMetadata(
                job.id,
                input.metadata,
              ),
          })
          .onConflictDoNothing({
            target:
              artifacts.storageKey,
          })
          .returning();

      let artifact =
        insertedArtifact[0];

      if (!artifact) {
        const existingArtifactResult =
          await tx
            .select()
            .from(artifacts)
            .where(
              eq(
                artifacts.storageKey,
                input.storageKey,
              ),
            )
            .limit(1);

        artifact =
          existingArtifactResult[0];

        if (!artifact) {
          throw new ArtifactRepositoryError(
            "Artifact could not be recovered after an idempotent conflict.",
            "PERSISTENCE_FAILED",
          );
        }

        if (
          artifact.ownerUserId !==
            job.userId ||
          (
            artifact.organizationId ??
            null
          ) !==
            (
              job.organizationId ??
              null
            )
        ) {
          throw new ArtifactRepositoryError(
            "Artifact storage key belongs to a different owner.",
            "OWNERSHIP_CONFLICT",
          );
        }
      }

      /*
       * Version 1 is immutable for this generation output.
       * The unique constraint makes concurrent retries safe.
       */
      const insertedVersion =
        await tx
          .insert(artifactVersions)
          .values({
            artifactId:
              artifact.id,
            version:
              artifact.version,
            storageUrl:
              input.storageUrl,
            changeSummary:
              "Initial generated video artifact.",
          })
          .onConflictDoNothing({
            target: [
              artifactVersions.artifactId,
              artifactVersions.version,
            ],
          })
          .returning();

      let artifactVersion =
        insertedVersion[0];

      if (!artifactVersion) {
        const existingVersionResult =
          await tx
            .select()
            .from(artifactVersions)
            .where(
              and(
                eq(
                  artifactVersions.artifactId,
                  artifact.id,
                ),
                eq(
                  artifactVersions.version,
                  artifact.version,
                ),
              ),
            )
            .limit(1);

        artifactVersion =
          existingVersionResult[0];

        if (!artifactVersion) {
          throw new ArtifactRepositoryError(
            "Artifact version could not be recovered.",
            "PERSISTENCE_FAILED",
          );
        }
      }

      /*
       * Create the canonical generation output with the durable
       * storage URL, never the provider URL.
       */
      const insertedOutput =
        await tx
          .insert(generationOutputs)
          .values({
            jobId:
              job.id,
            artifactId:
              artifact.id,
            type:
              job.type,
            url:
              input.storageUrl,
            mimeType:
              input.mimeType,
            sizeBytes:
              input.sizeBytes,
            metadata:
              generationArtifactMetadata(
                job.id,
                input.metadata,
              ),
            idempotencyKey,
          })
          .onConflictDoNothing({
            target: [
              generationOutputs.jobId,
              generationOutputs.idempotencyKey,
            ],
          })
          .returning();

      let generationOutput =
        insertedOutput[0];

      if (!generationOutput) {
        const existingResult =
          await tx
            .select()
            .from(generationOutputs)
            .where(
              and(
                eq(
                  generationOutputs.jobId,
                  job.id,
                ),
                eq(
                  generationOutputs.idempotencyKey,
                  idempotencyKey,
                ),
              ),
            )
            .limit(1);

        generationOutput =
          existingResult[0];

        if (!generationOutput) {
          throw new ArtifactRepositoryError(
            "Generation output could not be recovered.",
            "PERSISTENCE_FAILED",
          );
        }

        if (
          generationOutput.artifactId !== null &&
          generationOutput.artifactId !== artifact.id
        ) {
          throw new ArtifactRepositoryError(
            "Generation output is already linked to a different artifact.",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        if (
          generationOutput.url !==
            input.storageUrl ||
          generationOutput.mimeType !==
            input.mimeType ||
          !sameNullableNumber(
            generationOutput.sizeBytes,
            input.sizeBytes,
          )
        ) {
          throw new ArtifactRepositoryError(
            "Generation output exists with a different payload.",
            "IDEMPOTENCY_CONFLICT",
          );
        }
      }

      /*
       * Legacy output with no artifact link is only linked when the
       * payload already matches the durable storage URL.
       */
      if (
        existingOutput &&
        existingOutput.artifactId === null
      ) {
        const updated =
          await tx
            .update(generationOutputs)
            .set({
              artifactId:
                artifact.id,
            })
            .where(
              and(
                eq(
                  generationOutputs.id,
                  existingOutput.id,
                ),
                isNull(
                  generationOutputs.artifactId,
                ),
                eq(
                  generationOutputs.url,
                  input.storageUrl,
                ),
              ),
            )
            .returning();

        generationOutput =
          updated[0];

        if (!generationOutput) {
          throw new ArtifactRepositoryError(
            "Legacy generation output could not be linked safely.",
            "IDEMPOTENCY_CONFLICT",
          );
        }
      }

      return {
        artifact,
        artifactVersion,
        generationOutput,
      };
    },
  );
}

