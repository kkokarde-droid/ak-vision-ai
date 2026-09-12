import { createHiggsfieldClient } from "@Higgsfield/client/v2";
import type { HiggsfieldClient } from "@Higgsfield/client";
import type { V2Response } from "@Higgsfield/client/v2";
import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "@ak-vision-ai/ai-core";

import type {
  AIResponse,
  AITaskType,
} from "@ak-vision-ai/types";

export type HiggsfieldProviderOptions = {
  credentials?: string;
  baseURL?: string;
  pollIntervalMs?: number;
  maxPollTimeMs?: number;
  client?: ReturnType<typeof createHiggsfieldClient>;
  fetchImpl?: typeof fetch;
};

type HiggsfieldVideoInput = {
  model?:
    | "dop-lite"
    | "dop-turbo"
    | "dop-standard";
  imageUrl?: string;
  imageUrls?: string[];
  input_images?: Array<{
    type: "image_url";
    image_url: string;
  }>;
  motions?: Array<{
    id: string;
    strength: number;
  }>;
  seed?: number;
  enhance_prompt?: boolean;
  duration?: 3 | 5;
};

type HiggsfieldTextToVideoInput = {
  model: "seedance_2_0";
  prompt: string;
  duration: number;
  aspect_ratio:
    | "auto"
    | "16:9"
    | "9:16"
    | "4:3"
    | "3:4"
    | "1:1"
    | "21:9";
  resolution:
    | "480p"
    | "720p"
    | "1080p"
    | "4k";
  mode: "std" | "fast";
  bitrate_mode: "standard" | "high";
  genre:
    | "auto"
    | "action"
    | "horror"
    | "comedy"
    | "noir"
    | "drama"
    | "epic";
  generate_audio: boolean;
};

export type HiggsfieldNormalizedResult = {
  provider: "higgsfield";
  providerRequestId: string;
  status: "completed";
  output: {
    type: "video";
    url: string;
  };
  statusUrl?: string;
  cancelUrl?: string;
};

const DEFAULT_BASE_URL =
  "https://platform.higgsfield.ai";

const DEFAULT_POLL_INTERVAL_MS =
  2_000;

const DEFAULT_MAX_POLL_TIME_MS =
  300_000;

export class HiggsfieldProvider
  implements AIProvider
{
  readonly providerId = "higgsfield";

  readonly providerName =
    "Higgsfield AI";

  readonly status =
    "active" as const;

  readonly capabilities = [
    "video-generation",
    "image-to-video",
    "text-to-video",
  ] as const;

  private readonly client: ReturnType<typeof createHiggsfieldClient>;

  private readonly fetchImpl:
    typeof fetch;

  private readonly baseURL: string;

  private readonly pollIntervalMs: number;

  private readonly maxPollTimeMs: number;

  private readonly credentials:
    string | undefined;

  constructor(
    options: HiggsfieldProviderOptions = {},
  ) {
    this.credentials =
      options.credentials ??
      (
        process.env.HF_API_KEY?.trim() &&
        process.env.HF_API_SECRET?.trim()
          ? `${process.env.HF_API_KEY}:${process.env.HF_API_SECRET}`
          : process.env.HF_CREDENTIALS
      );
    const clientConfig: {
      credentials?: string;
      baseURL?: string;
      pollInterval?: number;
      maxPollTime?: number;
    } = {};

    if (this.credentials) {
      clientConfig.credentials =
        this.credentials;
    }

    if (options.baseURL) {
      clientConfig.baseURL =
        options.baseURL;
    }

    clientConfig.pollInterval =
      options.pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS;

    clientConfig.maxPollTime =
      options.maxPollTimeMs ??
      DEFAULT_MAX_POLL_TIME_MS;

    this.client =
      options.client ??
      createHiggsfieldClient(
        clientConfig,
      );

    this.fetchImpl =
      options.fetchImpl ??
      globalThis.fetch.bind(
        globalThis,
      );

    this.baseURL =
      options.baseURL ??
      DEFAULT_BASE_URL;

    this.pollIntervalMs =
      options.pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS;

    this.maxPollTimeMs =
      options.maxPollTimeMs ??
      DEFAULT_MAX_POLL_TIME_MS;

    if (
      !Number.isInteger(
        this.pollIntervalMs,
      ) ||
      this.pollIntervalMs <= 0
    ) {
      throw new Error(
        "Higgsfield pollIntervalMs must be a positive integer.",
      );
    }

    if (
      !Number.isInteger(
        this.maxPollTimeMs,
      ) ||
      this.maxPollTimeMs <= 0
    ) {
      throw new Error(
        "Higgsfield maxPollTimeMs must be a positive integer.",
      );
    }

    if (
      options.pollIntervalMs !==
        undefined &&
      options.pollIntervalMs >
        this.maxPollTimeMs
    ) {
      throw new Error(
        "Higgsfield pollIntervalMs cannot exceed maxPollTimeMs.",
      );
    }
  }

  supports(
    taskType: AITaskType,
  ): boolean {
    return (
      taskType ===
      "video-generation"
    );
  }

  supportsCapability(
    capability:
      (typeof this.capabilities)[number],
  ): boolean {
    return (
      this.capabilities.includes(
        capability,
      )
    );
  }

  async generate<T = unknown>(
  input: AIProviderRequest,
  context: AIProviderContext,
): Promise<AIResponse<T>> {
  if (context.signal?.aborted) {
    throw new Error("AI provider execution aborted.");
  }

  if (input.taskType !== "video-generation") {
    return {
      requestId: context.requestId,
      success: false,
      errorCode: "UNSUPPORTED_TASK_TYPE",
      errorMessage:
        "HiggsfieldProvider supports video-generation only.",
      createdAt: new Date().toISOString(),
    };
  }

  const raw = input.request.input as
    | Record<string, unknown>
    | undefined;

  const mode =
    typeof raw?.mode === "string"
      ? raw.mode
      : "image_to_video";

  const existingProviderRequestId =
    this.readString(raw, "providerRequestId");

  let response: V2Response;

  if (existingProviderRequestId) {
    response = await this.pollExistingRequest(
      existingProviderRequestId,
      context.signal,
    );
  } else if (mode === "text_to_video") {
    response = await this.submitTextToVideo(
      input,
      raw,
      context,
    );
  } else {
    const videoInput = this.parseVideoInput(input);

    response = await this.submitRequest(
      input,
      videoInput,
      context,
    );
  }

  return this.toAIResponse<T>(
    response,
    context.requestId,
  );
}
  private parseVideoInput(
    input: AIProviderRequest,
  ): HiggsfieldVideoInput & {
    prompt: string;
    input_images: Array<{
      type: "image_url";
      image_url: string;
    }>;
  } {
    const raw =
      input.request.input;

    const candidate =
      raw as
        | HiggsfieldVideoInput
        | undefined;

    const images =
      Array.isArray(
        candidate?.input_images,
      )
        ? candidate.input_images
        : [];

    if (
      images.length === 0 &&
      typeof candidate?.imageUrl ===
        "string" &&
      candidate.imageUrl.trim()
    ) {
      images.push({
        type: "image_url",
        image_url:
          candidate.imageUrl.trim(),
      });
    }

    if (
      images.length === 0 &&
      Array.isArray(
        candidate?.imageUrls,
      )
    ) {
      for (
        const imageUrl of
        candidate.imageUrls
      ) {
        if (
          typeof imageUrl ===
            "string" &&
          imageUrl.trim()
        ) {
          images.push({
            type: "image_url",
            image_url:
              imageUrl.trim(),
          });
        }
      }
    }

    if (images.length === 0) {
      throw new Error(
        "Higgsfield video generation requires at least one input image URL.",
      );
    }

    if (
      images.length >
      8
    ) {
      throw new Error(
        "Higgsfield video generation supports at most 8 input images.",
      );
    }

    const model =
      candidate?.model ??
      "dop-turbo";

    const duration =
      candidate?.duration ??
      5;

    if (
      duration !== 3 &&
      duration !== 5
    ) {
      throw new Error(
        "Higgsfield DoP duration must be 3 or 5 seconds.",
      );
    }

    if (
      model !== "dop-lite" &&
      model !== "dop-turbo" &&
      model !== "dop-standard"
    ) {
      throw new Error(
        "Invalid Higgsfield DoP model.",
      );
    }

    if (
      candidate?.seed !== undefined &&
      (
        !Number.isInteger(
          candidate.seed,
        ) ||
        candidate.seed < 0
      )
    ) {
      throw new Error(
        "Higgsfield seed must be a non-negative integer.",
      );
    }

    if (
      candidate?.motions !==
        undefined
    ) {
      if (
        !Array.isArray(
          candidate.motions,
        )
      ) {
        throw new Error(
          "Higgsfield motions must be an array.",
        );
      }

      for (
        const motion of
        candidate.motions
      ) {
        if (
          !motion ||
          typeof motion.id !==
            "string" ||
          !motion.id.trim() ||
          !Number.isFinite(
            motion.strength,
          ) ||
          motion.strength < 0 ||
          motion.strength > 1
        ) {
          throw new Error(
            "Invalid Higgsfield motion configuration.",
          );
        }
      }
    }

    return {
      model,
      duration,
      prompt:
        input.request.prompt,
      input_images:
        images,
      ...(candidate?.motions !==
      undefined
        ? {
            motions:
              candidate.motions,
          }
        : {}),
      ...(candidate?.seed !==
      undefined
        ? {
            seed:
              candidate.seed,
          }
        : {}),
      ...(candidate?.enhance_prompt !==
      undefined
        ? {
            enhance_prompt:
              candidate.enhance_prompt,
          }
        : {}),
    };
  }

  private async submitTextToVideo(
    input: AIProviderRequest,
    _raw: Record<string, unknown> | undefined,
    context: AIProviderContext,
  ): Promise<V2Response> {
    if (this.credentials === undefined) {
      throw new Error(
        "Higgsfield credentials are required.",
      );
    }

    const endpoint =
      process.env.HF_TEXT_TO_VIDEO_ENDPOINT?.trim();

    if (!endpoint) {
      throw new Error(
        "Higgsfield text-to-video endpoint is not configured.",
      );
    }

    const raw =
      input.request.input as
        | Record<string, unknown>
        | undefined;

    const prompt =
      input.request.prompt.trim();

    if (!prompt) {
      throw new Error(
        "Higgsfield text-to-video requires a non-empty prompt.",
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
        "Higgsfield Seedance 2.0 duration must be an integer between 4 and 15 seconds.",
      );
    }

    const aspectRatio =
      typeof raw?.aspectRatio === "string"
        ? raw.aspectRatio
        : "9:16";

    const supportedAspectRatios = [
      "auto",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "1:1",
      "21:9",
    ];

    if (
      !supportedAspectRatios.includes(
        aspectRatio,
      )
    ) {
      throw new Error(
        "Invalid Higgsfield Seedance 2.0 aspect ratio.",
      );
    }

    const resolution =
      typeof raw?.resolution === "string"
        ? raw.resolution
        : "720p";

    if (
      resolution !== "480p" &&
      resolution !== "720p" &&
      resolution !== "1080p" &&
      resolution !== "4k"
    ) {
      throw new Error(
        "Invalid Higgsfield Seedance 2.0 resolution.",
      );
    }

    const mode =
      raw?.mode === "fast"
        ? "fast"
        : "std";

    if (
      mode === "fast" &&
      resolution !== "480p" &&
      resolution !== "720p"
    ) {
      throw new Error(
        "Higgsfield Seedance 2.0 fast mode supports only 480p or 720p.",
      );
    }

    const bitrateMode =
      raw?.bitrate_mode === "high"
        ? "high"
        : "standard";

    const allowedGenres = [
      "auto",
      "action",
      "horror",
      "comedy",
      "noir",
      "drama",
      "epic",
    ];

    const genre =
      typeof raw?.genre === "string" &&
      allowedGenres.includes(raw.genre)
        ? raw.genre
        : "auto";

    const generateAudio =
      typeof raw?.generate_audio === "boolean"
        ? raw.generate_audio
        : true;

    const dimensionsByAspectRatio: Record<
  string,
  { width: number; height: number }
> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "4:3": { width: 960, height: 720 },
  "3:4": { width: 720, height: 960 },
  "1:1": { width: 720, height: 720 },
  "21:9": { width: 1680, height: 720 },
};

const dimensions =
  dimensionsByAspectRatio[aspectRatio] ??
  { width: 720, height: 720 };

const videoInput = {
  model: "seedance_2_0",
  prompt,
  aspect_ratio: aspectRatio,
  batch_size: 1,
  duration,
  resolution,
  width: dimensions.width,
  height: dimensions.height,
  mode,
  bitrate_mode: bitrateMode,
  genre,
  generate_audio: generateAudio,
};

    const fullEndpoint =
      endpoint.startsWith("http://") ||
      endpoint.startsWith("https://")
        ? endpoint
        : `${this.baseURL}/${endpoint.replace(/^\/+/, "")}`;

    let response: Response;

    try {
      response =
        await this.fetchImpl(
          fullEndpoint,
          {
            method: "POST",
            headers: {
              Authorization:
                `Key ${this.credentials}`,
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(videoInput),
            ...(context.signal !== undefined
              ? {
                  signal:
                    context.signal,
                }
              : {}),
          },
        );
    } catch (error) {
      throw this.normalizeSDKError(
        error,
      );
    }

    if (!response.ok) {
      let detail: unknown;

      try {
        detail =
          await response.json();
      } catch {
        detail = undefined;
      }

      const error = new Error(
        `Higgsfield text-to-video request failed with HTTP ${response.status}.`,
      );

      Object.assign(error, {
        status: response.status,
        response: {
          status: response.status,
          data: detail,
        },
      });

      throw this.normalizeSDKError(
        error,
      );
    }

    const result =
      (await response.json()) as V2Response;

    if (!result.request_id) {
      throw new Error(
        "Higgsfield text-to-video did not return a provider request id.",
      );
    }

    if (
      context.onSubmitted !==
      undefined
    ) {
      await context.onSubmitted(
        result.request_id,
      );
    }

    return this.pollV2(
      result.request_id,
      result.status_url,
      result,
      context.signal,
    );
  }
  private async submitRequest(
    input: AIProviderRequest,
    videoInput: HiggsfieldVideoInput & {
      prompt: string;
      input_images: Array<{
        type: "image_url";
        image_url: string;
      }>;
    },
    context: AIProviderContext,
  ): Promise<V2Response> {
    if (this.credentials === undefined) {
      throw new Error(
        "Higgsfield credentials are required.",
      );
    }

    const endpoint =
      `${this.baseURL}/v1/image2video/dop`;

    let response: Response;

    try {
      response =
        await this.fetchImpl(
          endpoint,
          {
            method: "POST",
            headers: {
              Authorization:
                `Key ${this.credentials}`,
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({ params: videoInput }),
            ...(context.signal !== undefined ? { signal: context.signal } : {}),
          },
        );
    } catch (error) {
      throw this.normalizeSDKError(
        error,
      );
    }

    if (!response.ok) {
      let detail: unknown;

      try {
        detail = await response.json();
      } catch {
        detail = undefined;
      }

      const error = new Error(
        `Higgsfield request failed with HTTP ${response.status}.`,
      );

      Object.assign(error, {
        status: response.status,
        response: {
          status: response.status,
          data: detail,
        },
      });

      throw this.normalizeSDKError(
        error,
      );
    }

    const result =
      (await response.json()) as V2Response;

    if (!result.request_id) {
      throw new Error(
        "Higgsfield did not return a provider request id.",
      );
    }

    if (
      context.onSubmitted !==
      undefined
    ) {
      await context.onSubmitted(
        result.request_id,
      );
    }

    return this.pollV2(
      result.request_id,
      result.status_url,
      result,
      context.signal,
    );
  }

  private async pollExistingRequest(
    providerRequestId: string,
    signal?: AbortSignal,
  ): Promise<V2Response> {
    const statusURL =
      `${this.baseURL}/requests/${encodeURIComponent(providerRequestId)}/status`;

    return this.pollV2(
      providerRequestId,
      statusURL,
      {
        status: "queued",
        request_id:
          providerRequestId,
        status_url:
          statusURL,
        cancel_url:
          `${this.baseURL}/requests/${encodeURIComponent(providerRequestId)}/cancel`,
      },
      signal,
    );
  }

  private async pollV2(
    providerRequestId: string,
    statusURL: string,
    initialResponse: V2Response,
    signal?: AbortSignal,
  ): Promise<V2Response> {
    const startedAt =
      Date.now();

    let latest =
      initialResponse;

    while (true) {
      if (
        signal?.aborted
      ) {
        throw new Error(
          "AI provider execution aborted.",
        );
      }

      if (
        Date.now() - startedAt >
        this.maxPollTimeMs
      ) {
        throw new Error(
          "AI provider execution timed out.",
        );
      }

      if (
        latest.status ===
          "completed" ||
        latest.status ===
          "failed" ||
        latest.status ===
          "nsfw"
      ) {
        return latest;
      }

      try {
        latest =
          await this.fetchStatus(
            statusURL,
            signal,
          );
      } catch (error) {
        const transient =
          this.isTransientPollingError(
            error,
          );

        if (!transient) {
          throw error;
        }
      }

      if (
        latest.status ===
          "completed" ||
        latest.status ===
          "failed" ||
        latest.status ===
          "nsfw"
      ) {
        return latest;
      }

      await this.sleep(
        this.pollIntervalMs,
        signal,
      );
    }
  }

  private async fetchStatus(
    statusURL: string,
    signal?: AbortSignal,
  ): Promise<V2Response> {
    const headers: Record<
      string,
      string
    > = {
      Accept:
        "application/json",
    };

    if (this.credentials) {
      headers.Authorization =
        `Key ${this.credentials}`;
    }

    const response =
      await this.fetchImpl(
        statusURL,
        {
          method: "GET",
          headers,
          ...(signal ? { signal } : {}),
        },
      );

    if (
      response.status >= 500 ||
      response.status === 429
    ) {
      throw new Error(
        `Higgsfield status request temporary failure: HTTP ${response.status}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Higgsfield status request failed: HTTP ${response.status}`,
      );
    }

    const payload =
      (await response.json()) as unknown;

    if (
      !this.isV2Response(
        payload,
      )
    ) {
      throw new Error(
        "Higgsfield returned an invalid status response.",
      );
    }

    return payload;
  }

  private isTransientPollingError(
    error: unknown,
  ): boolean {
    return (
      error instanceof Error &&
      error.message.includes(
        "temporary failure",
      )
    );
  }

  private async sleep(
    durationMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await new Promise<void>(
      (resolve, reject) => {
        let timer:
          | ReturnType<
              typeof setTimeout
            >
          | undefined;

        const onAbort = () => {
          if (
            timer !== undefined
          ) {
            clearTimeout(timer);
          }

          reject(
            new Error(
              "AI provider execution aborted.",
            ),
          );
        };

        if (
          signal?.aborted
        ) {
          onAbort();
          return;
        }

        if (signal) {
          signal.addEventListener(
            "abort",
            onAbort,
            {
              once: true,
            },
          );
        }

        timer = setTimeout(() => {
          if (signal) {
            signal.removeEventListener(
              "abort",
              onAbort,
            );
          }

          resolve();
        }, durationMs);
      },
    );
  }

  private toAIResponse<T>(
    response: V2Response,
    requestId: string,
  ): AIResponse<T> {
    const now =
      new Date().toISOString();

    if (
      response.status ===
      "completed"
    ) {
      const videoURL =
        response.video?.url;

      if (!videoURL) {
        return {
          requestId,
          success: false,
          errorCode:
            "PROVIDER_INVALID_RESPONSE",
          errorMessage:
            "Higgsfield completed the request without returning a video URL.",
          createdAt: now,
        };
      }

      const result: HiggsfieldNormalizedResult = {
        provider:
          "higgsfield",
        providerRequestId:
          response.request_id,
        status:
          "completed",
        output: {
          type: "video",
          url: videoURL,
        },
        ...(response.status_url
          ? {
              statusUrl:
                response.status_url,
            }
          : {}),
        ...(response.cancel_url
          ? {
              cancelUrl:
                response.cancel_url,
            }
          : {}),
      };

      return {
        requestId,
        success: true,
        result:
          result as T,
        createdAt: now,
      };
    }

    if (
      response.status ===
      "nsfw"
    ) {
      return {
        requestId,
        success: false,
        errorCode:
          "PROVIDER_CONTENT_POLICY",
        errorMessage:
          "Higgsfield rejected this generation for content policy reasons.",
        createdAt: now,
      };
    }

    if (
      response.status ===
      "failed"
    ) {
      return {
        requestId,
        success: false,
        errorCode:
          "PROVIDER_GENERATION_FAILED",
        errorMessage:
          "Higgsfield failed to generate the requested video.",
        createdAt: now,
      };
    }

    return {
      requestId,
      success: false,
      errorCode:
        "PROVIDER_INCOMPLETE_RESPONSE",
      errorMessage:
        `Unexpected terminal status from Higgsfield: ${response.status}`,
      createdAt: now,
    };
  }

  private normalizeSDKError(
    error: unknown,
  ): Error {
    if (
      error instanceof Error
    ) {
      const message =
        error.message;

      if (
        message.includes(
          "Invalid API credentials",
        )
      ) {
        return new Error(
          "Higgsfield authentication failed.",
        );
      }

      if (
        message.includes(
          "Insufficient",
        )
      ) {
        return new Error(
          "Higgsfield provider credits are insufficient.",
        );
      }

      if (
        message.includes(
          "Credentials",
        )
      ) {
        return new Error(
          "Higgsfield credentials are not configured.",
        );
      }

      return error;
    }

    return new Error(
      "Unknown Higgsfield provider error.",
    );
  }

  private readString(
    input:
      | Record<string, unknown>
      | undefined,
    key: string,
  ): string | undefined {
    const value =
      input?.[key];

    return typeof value ===
      "string" &&
      value.trim()
      ? value.trim()
      : undefined;
  }

  private isV2Response(
    value: unknown,
  ): value is V2Response {
    if (
      !value ||
      typeof value !==
        "object"
    ) {
      return false;
    }

    const candidate =
      value as {
        status?: unknown;
        request_id?: unknown;
        status_url?: unknown;
        cancel_url?: unknown;
      };

    return (
      (
        candidate.status ===
          "queued" ||
        candidate.status ===
          "in_progress" ||
        candidate.status ===
          "completed" ||
        candidate.status ===
          "failed" ||
        candidate.status ===
          "nsfw"
      ) &&
      typeof candidate.request_id ===
        "string" &&
      typeof candidate.status_url ===
        "string" &&
      typeof candidate.cancel_url ===
        "string"
    );
  }
}






