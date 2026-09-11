import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "@ak-vision-ai/ai-core";

import type {
  AIResponse,
  AITaskType,
} from "@ak-vision-ai/types";

const MOCK_VIDEO_URL =
  "https://mdn.github.io/shared-assets/videos/flower.mp4";

export class MockVideoProvider implements AIProvider {
  readonly providerId = "mock-video";

  readonly providerName =
    "Development Mock Video";

  readonly status = "active" as const;

  readonly capabilities = [
    "video-generation",
    "text-to-video",
    "image-to-video",
  ] as const;

  supports(taskType: AITaskType): boolean {
    return taskType === "video-generation";
  }

  supportsCapability(
    capability: (typeof this.capabilities)[number],
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
        "Mock video generation was aborted.",
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
          "MockVideoProvider supports video-generation only.",
        createdAt:
          new Date().toISOString(),
      };
    }

    const providerRequestId =
      `mock-video:${context.requestId}`;

    if (
      context.onSubmitted !==
      undefined
    ) {
      await context.onSubmitted(
        providerRequestId,
      );
    }

    return {
      requestId: context.requestId,
      success: true,
      result: {
        output: {
          type: "video",
          url: MOCK_VIDEO_URL,
          mimeType: "video/mp4",
        },
        providerRequestId,
        mock: true,
      } as T,
      createdAt:
        new Date().toISOString(),
    };
  }
}
