import { AIRouter } from "./router.js";
import { ProviderRegistry } from "./registry.js";
import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "./provider.js";
import type {
  AIRequest,
  AIResponse,
  AITaskType,
} from "@ak-vision-ai/types";

class TestProvider implements AIProvider {
  constructor(
    public readonly providerId: string,
    public readonly providerName: string,
    private readonly supportedTasks: AITaskType[],
  ) {}

  supports(taskType: AITaskType): boolean {
    return this.supportedTasks.includes(taskType);
  }

  async generate<T = unknown>(
    input: AIProviderRequest,
    context: AIProviderContext,
  ): Promise<AIResponse<T>> {
    return {
      requestId: context.requestId,
      success: true,
      result: {
        provider: this.providerId,
        taskType: input.taskType,
      } as T,
      createdAt: new Date().toISOString(),
    };
  }
}

const registry = new ProviderRegistry();

const fastProvider = new TestProvider(
  "fast-provider",
  "Fast Provider",
  ["chat"],
);

const qualityProvider = new TestProvider(
  "quality-provider",
  "Quality Provider",
  ["chat"],
);

registry.register(fastProvider);
registry.register(qualityProvider);

const router = new AIRouter(registry, {
  preferredProviderId: "quality-provider",
});

const taskType: AITaskType = "chat";

const request: {
  request: AIRequest;
  taskType: AITaskType;
} = {
  request: {
    taskType,
    mode: "quality",
  } as AIRequest,
  taskType,
};

const decision = router.route(request);

if (decision.provider.providerId !== "quality-provider") {
  throw new Error(
    `Expected quality-provider but got ${decision.provider.providerId}`,
  );
}

if (decision.candidates.length !== 2) {
  throw new Error(
    `Expected 2 candidates but got ${decision.candidates.length}`,
  );
}

console.log("AI router test passed.");
console.log(`Selected provider: ${decision.provider.providerId}`);
console.log(`Reason: ${decision.reason}`);

console.log(
  "Candidates:",
  decision.candidates.map((candidate) => ({
    provider: candidate.provider.providerId,
    score: candidate.score,
  })),
);
