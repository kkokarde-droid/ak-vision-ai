import { fal } from "@fal-ai/client";

import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "@ak-vision-ai/ai-core";

import type {
  AIResponse,
  AITaskType,
} from "@ak-vision-ai/types";

const FAL_T2V_ENDPOINT =
  "bytedance/seedance-2.0/text-to-video";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLL_TIME_MS = 300_000;

type FalVideoInput = {
  prompt: string;
  resolution: "720p";
  duration: string;
  aspect_ratio:
    | "16:9"
    | "9:16"
    | "4:3"
    | "3:4"
    | "1:1"
    | "21:9"
    | "auto";
  generate_audio: boolean;
  bitrate_mode: "standard" | "high";
  end_user_id: string;
};

type FalQueueStatus = {
  status?: string;
  error?: unknown;
};

type FalQueueResult = {
  data?: {
    video?: {
      url?: string;
      content_type?: string;
      file_name?: string;
      file_size?: number;
    };
    seed?: number;
  };
  requestId?: string;
};

export type FalProviderOptions = {
  credentials?: string;
  pollIntervalMs?: number;
  maxPollTimeMs?: number;
};

export class FalProvider implements AIProvider {
  readonly providerId = "fal";

  readonly providerName = "Fal";

  readonly status = "active" as const;

  readonly capabilities = [
    "video-generation",
    "text-to-video",
  ] as const;

  private readonly credentials: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollTimeMs: number;

  constructor(
    options: FalProviderOptions = {},
  ) {
    const credentials =
      options.credentials ??
      process.env.FAL_KEY?.trim();

    if (!credentials) {
      throw new Error(
        "FAL_KEY is required for FalProvider.",
      );
    }

    this.credentials = credentials;

    this.pollIntervalMs =
      options.pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS;

    this.maxPollTimeMs =
      options.maxPollTimeMs ??
      DEFAULT_MAX_POLL_TIME_MS;

    if (
      !Number.isInteger(this.pollIntervalMs) ||
      this.pollIntervalMs <= 0
    ) {
      throw new Error(
        "Fal pollIntervalMs must be a positive integer.",
      );
    }

    if (
      !Number.isInteger(this.maxPollTimeMs) ||
      this.maxPollTimeMs <= 0
    ) {
      throw new Error(
        "Fal maxPollTimeMs must be a positive integer.",
      );
    }

    if (
      this.pollIntervalMs > this.maxPollTimeMs
    ) {
      throw new Error(
        "Fal pollIntervalMs cannot exceed maxPollTimeMs.",
      );
    }

    fal.config({
      credentials: this.credentials,
    });
  }

  supports(
    taskType: AITaskType,
  ): boolean {
    return taskType === "video-generation";
  }

  supportsCapability(
    capability:
      (typeof this.capabilities)[number],
  ): boolean {
    return this.capabilities.includes(
      capability,
    );
  }

  async generate<T = unknown>(
    input: AIProviderRequest,
    context: AIProviderContext,
  ): Promise<AIResponse<T>> {
    if (context.signal?.aborted) {
      throw new Error(
        "AI provider execution aborted.",
      );
    }

    if (
      input.taskType !==
      "video-generation"
    ) {
      return {
        requestId: context.requestId,
        success: false,
        errorCode:
          "UNSUPPORTED_TASK_TYPE",
        errorMessage:
          "FalProvider supports video-generation only.",
        createdAt:
          new Date().toISOString(),
      };
    }

    const raw =
      input.request.input as
        | Record<string, unknown>
        | undefined;

    const prompt =
      input.request.prompt.trim();

    if (!prompt) {
      throw new Error(
        "Fal Seedance 2.0 requires a non-empty prompt.",
      );
    }

    const duration =
      typeof raw?.duration === "number"
        ? raw.duration
        : 5;

    if (
      !Number.isInteger(duration) ||
      duration < 4 ||
      duration > 15
    ) {
      throw new Error(
        "Fal Seedance 2.0 duration must be an integer between 4 and 15 seconds.",
      );
    }

    const aspectRatio =
      typeof raw?.aspectRatio ===
      "string"
        ? raw.aspectRatio
        : "9:16";

    const allowedAspectRatios = [
      "auto",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "1:1",
      "21:9",
    ];

    if (
      !allowedAspectRatios.includes(
        aspectRatio,
      )
    ) {
      throw new Error(
        "Invalid Fal Seedance 2.0 aspect ratio.",
      );
    }

    const generateAudio =
      typeof raw?.generate_audio ===
      "boolean"
        ? raw.generate_audio
        : true;

    const bitrateMode =
      raw?.bitrate_mode === "high"
        ? "high"
        : "standard";

    const requestInput:
      FalVideoInput = {
      prompt,
      resolution: "720p",
      duration: String(duration),
      aspect_ratio:
        aspectRatio as FalVideoInput["aspect_ratio"],
      generate_audio:
        generateAudio,
      bitrate_mode:
        bitrateMode,
      end_user_id:
        context.userId,
    };

    let submitted;

    try {
      submitted =
        await fal.queue.submit(
          FAL_T2V_ENDPOINT,
          {
            input:
              requestInput,
          },
        );
    } catch (error) {      throw new Error(
        error instanceof Error
          ? `Fal Seedance 2.0 submission failed: ${error.message}`
          : "Fal Seedance 2.0 submission failed.",
      );
    }

    const providerRequestId =
      submitted.request_id;

    if (
      typeof providerRequestId !==
      "string" ||
      !providerRequestId.trim()
    ) {
      throw new Error(
        "Fal Seedance 2.0 did not return a provider request ID.",
      );
    }

    if (
      context.onSubmitted !==
      undefined
    ) {
      await context.onSubmitted(
        providerRequestId,
      );
    }

    const startedAt = Date.now();

    while (
      Date.now() - startedAt <
      this.maxPollTimeMs
    ) {
      if (
        context.signal?.aborted
      ) {
        throw new Error(
          "AI provider execution aborted.",
        );
      }

      let status:
        FalQueueStatus;

      try {
        status =
          await fal.queue.status(
            FAL_T2V_ENDPOINT,
            {
              requestId:
                providerRequestId,
            },
          ) as FalQueueStatus;
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? `Fal Seedance 2.0 status check failed: ${error.message}`
            : "Fal Seedance 2.0 status check failed.",
        );
      }

      if (
        status.status ===
        "FAILED"
      ) {
        const detail =
          typeof status.error ===
          "string"
            ? status.error
            : "Fal provider reported generation failure.";

        throw new Error(
          `Fal Seedance 2.0 generation failed: ${detail}`,
        );
      }

      if (
        status.status ===
        "COMPLETED"
      ) {
        let result:
          FalQueueResult;

        try {
          result =
            await fal.queue.result(
              FAL_T2V_ENDPOINT,
              {
                requestId:
                  providerRequestId,
              },
            ) as FalQueueResult;
        } catch (error) {
          throw new Error(
            error instanceof Error
              ? `Fal Seedance 2.0 result retrieval failed: ${error.message}`
              : "Fal Seedance 2.0 result retrieval failed.",
          );
        }

        const videoUrl =
          result.data?.video?.url;

        if (
          typeof videoUrl !==
            "string" ||
          !videoUrl.trim()
        ) {
          throw new Error(
            "Fal Seedance 2.0 completed without a usable video URL.",
          );
        }

        return {
          requestId:
            context.requestId,
          success: true,
          result: {
            output: {
              type: "video",
              url: videoUrl,
              mimeType:
                result.data?.video
                  ?.content_type ??
                "video/mp4",
            },
            providerRequestId,
            seed:
              result.data?.seed ??
              null,
          } as T,
          usage: {
            durationMs:
              Date.now() -
              startedAt,
          },
          createdAt:
            new Date().toISOString(),
        };
      }

      await new Promise<void>(
        (resolve) =>
          setTimeout(
            resolve,
            this.pollIntervalMs,
          ),
      );
    }

    throw new Error(
      `Fal Seedance 2.0 polling exceeded ${this.maxPollTimeMs}ms.`,
    );
  }
}
