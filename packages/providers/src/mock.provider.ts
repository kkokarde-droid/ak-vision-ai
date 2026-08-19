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

  supports(taskType: AITaskType): boolean {
    return taskType === "chat";
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
