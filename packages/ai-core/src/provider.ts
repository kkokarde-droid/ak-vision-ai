import type {
  AIRequest,
  AIResponse,
  AITaskType,
  ProviderCapability,
  ProviderStatus,
} from "@ak-vision-ai/types";

export interface AIProviderRequest {
  request: AIRequest;
  taskType: AITaskType;
}

export interface AIProviderContext {
  requestId: string;
  userId: string;
  organizationId?: string;
  signal?: AbortSignal;
  onSubmitted?: (
    providerRequestId: string,
  ) => Promise<void>;
}

export interface AIProvider {
  readonly providerId: string;
  readonly providerName: string;

  readonly status: ProviderStatus;

  readonly capabilities: readonly ProviderCapability[];

  supports(taskType: AITaskType): boolean;

  supportsCapability(capability: ProviderCapability): boolean;

  generate<T = unknown>(
    input: AIProviderRequest,
    context: AIProviderContext,
  ): Promise<AIResponse<T>>;
}
