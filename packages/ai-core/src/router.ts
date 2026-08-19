import type {
  AIRequest,
  AIRequestMode,
  AITaskType,
} from "@ak-vision-ai/types";
import type { AIProvider } from "./provider.js";
import { ProviderRegistry } from "./registry.js";

export interface AIRouterRequest {
  request: AIRequest;
  taskType?: AITaskType;
}

export interface AIRouterCandidate {
  provider: AIProvider;
  score: number;
}

export interface AIRoutingDecision {
  provider: AIProvider;
  candidates: AIRouterCandidate[];
  reason: string;
}

export interface AIRouterOptions {
  preferredProviderId?: string;
}

export class AIRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly options: AIRouterOptions = {},
  ) {}

  route(input: AIRouterRequest): AIRoutingDecision {
    const taskType = input.taskType ?? input.request.taskType;
    const mode = input.request.mode;

    const eligibleProviders = this.registry.findForTask(taskType);

    if (eligibleProviders.length === 0) {
      throw new Error(`No provider available for task type: ${taskType}`);
    }

    const candidates = eligibleProviders
      .map((provider) => ({
        provider,
        score: this.scoreProvider(
          provider,
          taskType,
          mode,
          this.options.preferredProviderId,
        ),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        return a.provider.providerId.localeCompare(b.provider.providerId);
      });

    const selected = candidates[0];

    if (!selected) {
      throw new Error(`Unable to select provider for task type: ${taskType}`);
    }

    return {
      provider: selected.provider,
      candidates,
      reason: this.buildReason(selected.provider, mode),
    };
  }

  private scoreProvider(
    provider: AIProvider,
    taskType: AITaskType,
    mode: AIRequestMode,
    preferredProviderId?: string,
  ): number {
    let score = 0;

    if (provider.supports(taskType)) {
      score += 100;
    }

    if (preferredProviderId === provider.providerId) {
      score += 20;
    }

    switch (mode) {
      case "fast":
        score += 5;
        break;

      case "balanced":
        score += 10;
        break;

      case "quality":
        score += 15;
        break;

      case "auto":
        score += 10;
        break;
    }

    return score;
  }

  private buildReason(
    provider: AIProvider,
    mode: AIRequestMode,
  ): string {
    return `Selected ${provider.providerName} for ${mode} mode.`;
  }
}
