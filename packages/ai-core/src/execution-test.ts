import { AIExecutor } from "./execution.js";
import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "./provider.js";
import { ProviderRegistry } from "./registry.js";
import { AIRouter } from "./router.js";
import type {
  AIRequest,
  AIResponse,
  AITaskType,
} from "@ak-vision-ai/types";

class ExecutionTestProvider implements AIProvider {
  readonly status = "active" as const;
  readonly capabilities = ["chat"] as const;

  constructor(
    public readonly providerId: string,
    public readonly providerName: string,
  ) {}

  supports(taskType: AITaskType): boolean {
    return taskType === "chat";
  }

  supportsCapability(capability: "chat"): boolean {
    return capability === "chat";
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
        message: "Execution engine provider response",
      } as T,
      createdAt: new Date().toISOString(),
    };
  }
}

const registry = new ProviderRegistry();

const provider = new ExecutionTestProvider(
  "execution-test-provider",
  "Execution Test Provider",
);

registry.register(provider);

const router = new AIRouter(registry);

const executor = new AIExecutor(router);

const request: AIRequest = {
  id: "request-execution-test",
  userId: "user-execution-test",
  organizationId: "org-execution-test",
  taskType: "chat",
  prompt: "Test AI execution pipeline",
  mode: "balanced",
  createdAt: new Date().toISOString(),
};

const result = await executor.execute({
  request,
  context: {
    requestId: request.id,
    userId: request.userId,
    organizationId: request.organizationId,
  },
});

if (!result.response.success) {
  throw new Error(
    `Expected successful execution but got: ${result.response.errorMessage}`,
  );
}

if (result.providerId !== "execution-test-provider") {
  throw new Error(
    `Expected execution-test-provider but got ${result.providerId}`,
  );
}

if (result.routing.provider.providerId !== "execution-test-provider") {
  throw new Error(
    "Routing decision does not match executed provider.",
  );
}

console.log("AI execution test passed.");
console.log(`Provider: ${result.providerName}`);
console.log(`Success: ${result.response.success}`);
console.log(`Routing reason: ${result.routing.reason}`);
console.log("Result:", result.response.result);
