import {
  getCredits,
  getOwnedCreditReservation,
  settleCreditReservation,
} from "@ak-vision-ai/credits";
import type {
  GenerationJob,
} from "@ak-vision-ai/database";

import {
  AIExecutor,
  AIRouter,
  ProviderRegistry,
} from "@ak-vision-ai/ai-core";

import {
  persistGenerationArtifact,
  setGenerationProviderRequest,
} from "@ak-vision-ai/generation";

import {
  HiggsfieldProvider,
} from "@ak-vision-ai/providers";

import type {
  AIRequestMode,
} from "@ak-vision-ai/types";

import {
  downloadMedia,
} from "@ak-vision-ai/media";

import {
  LocalMediaStorage,
} from "@ak-vision-ai/storage";

import type {
  MediaStorage,
  StoredMediaObject,
} from "@ak-vision-ai/storage";


export interface GenerationProcessResult {
  output: Record<string, unknown>;
}

export interface GenerationProcessor {
  process(
    job: GenerationJob,
    signal: AbortSignal,
  ): Promise<GenerationProcessResult>;
}

export class GenerationProcessorError
  extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name =
      "GenerationProcessorError";
  }
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

function readMode(
  input: Record<string, unknown>,
): AIRequestMode {
  const mode = input.mode;

  if (
    mode === "fast" ||
    mode === "balanced" ||
    mode === "quality" ||
    mode === "auto"
  ) {
    return mode;
  }

  return "auto";
}

function createDefaultMediaStorage(): MediaStorage {
  const rootDirectory =
    process.env.MEDIA_STORAGE_ROOT?.trim() ||
    "worker-storage";

  const publicBaseUrl =
    process.env.MEDIA_STORAGE_PUBLIC_BASE_URL?.trim() ||
    "storage://local";

  return new LocalMediaStorage({
    rootDirectory,
    publicBaseUrl,
  });
}

function mediaWorkspaceRoot(): string {
  const configured =
    process.env.MEDIA_WORKSPACE_DIR?.trim();

  if (configured) {
    return configured;
  }

  return "worker-media";
}

async function finalizeProviderVideo(
  job: GenerationJob,
  providerUrl: string,
  signal: AbortSignal,
): Promise<{
  sourcePath: string;
  finalPath: string;
}> {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new GenerationProcessorError(
          "Generation media finalization was cancelled.",
          "GENERATION_CANCELLED",
          false,
        );
  }

  const pathModule =
    await import("node:path");
  const fs =
    await import("node:fs/promises");

  const workspace =
    pathModule.resolve(
      mediaWorkspaceRoot(),
      job.id,
    );

  await fs.mkdir(
    workspace,
    {
      recursive: true,
    },
  );

  const sourcePath =
    pathModule.join(
      workspace,
      "provider.mp4",
    );

  const finalPath =
    pathModule.join(
      workspace,
      "final.mp4",
    );

  try {
    await downloadMedia({
      url: providerUrl,
      outputPath: sourcePath,
      signal,
    });

    const { runFFmpeg } =
      await import("@ak-vision-ai/media");

    await runFFmpeg({
      args: [
        "-y",
        "-i",
        sourcePath,
        "-map",
        "0:v:0",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-movflags",
        "+faststart",
        finalPath,
      ],
      signal,
    });
  } catch (error) {
    if (error instanceof GenerationProcessorError) {
      throw error;
    }

    throw new GenerationProcessorError(
      error instanceof Error
        ? `Media finalization failed: ${error.message}`
        : "Media finalization failed.",
      "MEDIA_FINALIZATION_FAILED",
    );
  }

  return {
    sourcePath,
    finalPath,
  };
}
function positiveIntegerEnv(
  name: string,
  fallback: number,
): number {
  const raw =
    process.env[name];

  if (
    raw === undefined ||
    raw.trim() === ""
  ) {
    return fallback;
  }

  const value =
    Number(raw);

  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `${name} must be a positive integer`,
    );
  }

  return value;
}

export class AIExecutorGenerationProcessor
  implements GenerationProcessor {
  constructor(
    private readonly executor: AIExecutor,
    private readonly workerId: string,
      private readonly storage: MediaStorage =
      createDefaultMediaStorage(),
  ) {
    if (!workerId.trim()) {
      throw new Error(
        "workerId is required",
      );
    }
  }

  async process(
    job: GenerationJob,
    signal: AbortSignal,
  ): Promise<GenerationProcessResult> {
    if (job.type !== "video") {
      throw new GenerationProcessorError(
        `Generation type "${job.type}" is not supported by the V1 worker.`,
        "UNSUPPORTED_TASK_TYPE",
        false,
      );
    }

    const generationInput =
      isRecord(job.input)
        ? job.input
        : {};

    /*
     * Provider request ID is durable generation state.
     * On retry, feed it back to the provider so the worker polls
     * the already-submitted request instead of creating a duplicate.
     */
    const executionInput: Record<string, unknown> = {
      ...generationInput,
      ...(job.providerRequestId
        ? {
            providerRequestId:
              job.providerRequestId,
          }
        : {}),
    };

    const request = {
      id:
        job.requestId,
      userId:
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
      taskType:
        "video-generation" as const,
      prompt:
        job.prompt ?? "",
      mode:
        readMode(executionInput),
      ...(job.providerModelId
        ? {
            modelId:
              job.providerModelId,
          }
        : {}),
      input:
        executionInput,
      createdAt:
        job.createdAt.toISOString(),
    };

    const execution =
      await this.executor.execute({
        request,
        context: {
          requestId:
            job.requestId,
          userId:
            job.userId,
          ...(job.organizationId
            ? {
                organizationId:
                  job.organizationId,
              }
            : {}),
          onProviderSubmitted:
            async (
              providerRequestId,
              providerId,
            ) => {
              await setGenerationProviderRequest(
                job.id,
                this.workerId,
                providerId,
                providerRequestId,
              );
            },
        },
        signal,
      });

    /*
     * Second idempotent persistence attempt.
     *
     * This protects the submission boundary if the callback's first
     * persistence attempt experienced a transient failure.
     */
    if (
      execution.submittedProviderRequestId
    ) {
      await setGenerationProviderRequest(
        job.id,
        this.workerId,
        execution.providerId,
        execution.submittedProviderRequestId,
      );
    }

    if (
      !execution.response.success
    ) {
      const errorCode =
        execution.response.errorCode ??
        "GENERATION_PROVIDER_FAILED";

      const errorMessage =
        execution.response.errorMessage ??
        "AI provider failed to generate the requested video.";

      const retryable =
        errorCode !==
          "PROVIDER_CONTENT_POLICY" &&
        errorCode !==
          "UNSUPPORTED_TASK_TYPE";

      throw new GenerationProcessorError(
        errorMessage,
        errorCode,
        retryable,
      );
    }

    const result =
      execution.response.result;

    if (!isRecord(result)) {
      throw new GenerationProcessorError(
        "AI provider returned an invalid generation result.",
        "PROVIDER_INVALID_RESPONSE",
      );
    }

    const providerOutput =
      result.output;

    if (
      !isRecord(providerOutput) ||
      providerOutput.type !==
        "video" ||
      typeof providerOutput.url !==
        "string" ||
      !providerOutput.url.trim()
    ) {
      throw new GenerationProcessorError(
        "AI provider completed generation without a usable video output.",
        "PROVIDER_INVALID_RESPONSE",
      );
    }

    /*
     * Successful provider execution has produced a usable output.
     *
     * The generation reservation is the trusted customer-credit
     * boundary for V1. We settle the reserved amount using the
     * owner's authoritative balance currency. The settlement
     * operation is itself atomic and idempotent at the credit layer.
     */

    const mimeType =
      typeof providerOutput.mimeType ===
        "string" &&
      providerOutput.mimeType.trim()
        ? providerOutput.mimeType
        : "video/mp4";

    const finalized =
      await finalizeProviderVideo(
        job,
        providerOutput.url,
        signal,
      );

    let storedMedia;

    try {
      storedMedia =
        await this.storage.putFile({
          sourcePath:
            finalized.finalPath,
          key:
            `generations/${job.id}/final.mp4`,
          contentType:
            mimeType,
          signal,
        });
    } catch (error) {
      throw new GenerationProcessorError(
        error instanceof Error
          ? `Media storage persistence failed: ${error.message}`
          : "Media storage persistence failed.",
        "MEDIA_STORAGE_FAILED",
      );
    }

    const persistedArtifact =
      await persistGenerationArtifact({
        jobId:
          job.id,
        storageKey:
          storedMedia.key,
        storageUrl:
          storedMedia.url,
        name:
          "Generated Video.mp4",
        mimeType:
          mimeType,
        sizeBytes:
          storedMedia.sizeBytes,
        metadata: {
          provider:
            execution.providerId,
          providerName:
            execution.providerName,
          providerRequestId:
            execution.submittedProviderRequestId ??
            job.providerRequestId ??
            null,
          status:
            "completed",
        },
      });

    const creditOwner =
      job.organizationId
        ? {
            organizationId:
              job.organizationId,
          }
        : {
            userId:
              job.userId,
          };

    const reservation =
      await getOwnedCreditReservation(
        {
          reservationId:
            job.creditReservationId,
        },
        creditOwner,
      );

    const creditBalance =
      await getCredits(
        creditOwner,
      );

    if (!creditBalance) {
      throw new GenerationProcessorError(
        "Generation credit balance was not found for the reservation owner.",
        "CREDIT_BALANCE_NOT_FOUND",
      );
    }

    if (
      reservation.status !==
      "reserved" &&
      reservation.status !==
      "consumed"
    ) {
      throw new GenerationProcessorError(
        `Generation credit reservation is not settleable: ${reservation.status}`,
        "CREDIT_RESERVATION_INVALID_STATE",
        false,
      );
    }

    if (
      reservation.status ===
      "reserved"
    ) {
      await settleCreditReservation(
        {
          reservationId:
            job.creditReservationId,
          referenceId:
            job.requestId,
          usage: {
            requestId:
              job.requestId,
            providerId:
              execution.providerId,
            ...(job.providerModelId
              ? {
                  providerModelId:
                    job.providerModelId,
                }
              : {}),
            creditsUsed:
              reservation.amount,
            currency:
              creditBalance.currency,
          },
        },
        creditOwner,
      );
    }
    const outputRecord =
      persistedArtifact.generationOutput;

    return {
      output: {
        provider:
          execution.providerId,
        providerName:
          execution.providerName,
        providerRequestId:
          execution.submittedProviderRequestId ??
          job.providerRequestId ??
          null,
        artifactId:
          persistedArtifact.artifact.id,
        generationOutputId:
          outputRecord.id,
        storageKey:
          persistedArtifact.artifact.storageKey,
        output: {
          type:
            outputRecord.type,
          url:
            outputRecord.url,
          mimeType:
            outputRecord.mimeType,
          ...(outputRecord.sizeBytes !==
          null
            ? {
                sizeBytes:
                  outputRecord.sizeBytes,
              }
            : {}),
        },
      },
    };
  }
}

export function createDefaultGenerationProcessor(
  workerId: string,
): GenerationProcessor {
  const registry =
    new ProviderRegistry();

  registry.register(
    new HiggsfieldProvider({
      ...(process.env.HF_CREDENTIALS
        ? {
            credentials:
              process.env.HF_CREDENTIALS,
          }
        : {}),
      ...(process.env.HF_BASE_URL
        ? {
            baseURL:
              process.env.HF_BASE_URL,
          }
        : {}),
      ...(process.env.HF_POLL_INTERVAL_MS
        ? {
            pollIntervalMs:
              positiveIntegerEnv(
                "HF_POLL_INTERVAL_MS",
                2_000,
              ),
          }
        : {}),
      ...(process.env.HF_MAX_POLL_TIME_MS
        ? {
            maxPollTimeMs:
              positiveIntegerEnv(
                "HF_MAX_POLL_TIME_MS",
                300_000,
              ),
          }
        : {}),
    }),
  );

  const router =
    new AIRouter(
      registry,
      {
        preferredProviderId:
          "higgsfield",
      },
    );

  const executor =
    new AIExecutor(
      router,
      {
        timeoutMs:
          positiveIntegerEnv(
            "AI_EXECUTION_TIMEOUT_MS",
            300_000,
          ),
        retryCount:
          positiveIntegerEnv(
            "AI_EXECUTION_RETRY_COUNT",
            1,
          ),
        fallbackEnabled:
          false,
      },
    );

  return new AIExecutorGenerationProcessor(
    executor,
    workerId,
  );
}



