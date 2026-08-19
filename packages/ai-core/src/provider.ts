import type {
  AIRequest,
  AIResponse,
  AITaskType,
} from "@ak-vision-ai/types";

export interface AIProviderRequest {
  request: AIRequest;
  taskType: AITaskType;
}

export interface AIProviderContext {
  requestId: string;
  userId: string;
  organizationId: string;
}

export interface AIProvider {
  readonly providerId: string;
  readonly providerName: string;

  supports(taskType: AITaskType): boolean;

  generate<T = unknown>(
    input: AIProviderRequest,
    context: AIProviderContext,
  ): Promise<AIResponse<T>>;
}
