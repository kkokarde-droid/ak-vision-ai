import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "@ak-vision-ai/ai-core";

import type {
  AIResponse,
  AITaskType,
} from "@ak-vision-ai/types";

export class MockProvider implements AIProvider {
  readonly providerId = "mock";
  readonly providerName = "Mock Provider";

  readonly status = "active" as const;

  readonly capabilities = [
    "chat",
  ] as const;

  supports(taskType: AITaskType): boolean {
    return taskType === "chat";
  }

  supportsCapability(capability: (typeof this.capabilities)[number]): boolean {
    return this.capabilities.includes(
      capability as (typeof this.capabilities)[number],
    );
  }

  async generate<T = unknown>(
    input: AIProviderRequest,
    context: AIProviderContext,
  ): Promise<AIResponse<T>> {
    return {
      requestId: context.requestId,
      success: true,
      result: {
        provider: this.providerName,
        taskType: input.taskType,
        message: "Mock provider response",
      } as T,
      createdAt: new Date().toISOString(),
    };
  }
}
