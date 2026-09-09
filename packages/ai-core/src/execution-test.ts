import { AIExecutor } from "./execution.js";
import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "./provider.js";
import { AIRouter } from "./router.js";
import { ProviderRegistry } from "./registry.js";
import type {
  AIRequest,
  AIResponse,
  AITaskType,
} from "@ak-vision-ai/types";

function assertCondition(
  condition: boolean,
  message: string,
): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(
  actual: T,
  expected: T,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${message}. Expected ${String(expected)}, got ${String(actual)}.`,
    );
  }
}

class ExecutionTestProvider implements AIProvider {
  readonly status = "active" as const;
  readonly capabilities = ["chat"] as const;

  public generateCalls = 0;
  public submittedRequestIds: string[] = [];

  constructor(
    public readonly providerId: string,
    public readonly providerName: string,
    private readonly options: {
      delayMs?: number;
      fail?: boolean;
    } = {},
  ) {}

  supports(taskType: AITaskType): boolean {
    return taskType === "chat";
  }

  supportsCapability(
    capability: "chat",
  ): boolean {
    return capability === "chat";
  }

  async generate<T = unknown>(
    input: AIProviderRequest,
    context: AIProviderContext,
  ): Promise<AIResponse<T>> {
    this.generateCalls += 1;

    if (context.onSubmitted !== undefined) {
      const providerRequestId =
        `${this.providerId}-request-${this.generateCalls}`;

      this.submittedRequestIds.push(
        providerRequestId,
      );

      await context.onSubmitted(
        providerRequestId,
      );
    }

    if (this.options.delayMs !== undefined) {
      await new Promise<void>(
        (resolve) =>
          setTimeout(
            resolve,
            this.options.delayMs,
          ),
      );
    }

    if (this.options.fail) {
      return {
        requestId: context.requestId,
        success: false,
        errorCode:
          "TEST_PROVIDER_FAILURE",
        errorMessage:
          "Intentional test provider failure.",
        createdAt:
          new Date().toISOString(),
      };
    }

    return {
      requestId: context.requestId,
      success: true,
      result: {
        provider: this.providerId,
        taskType: input.taskType,
        message:
          "Execution engine provider response",
      } as T,
      createdAt:
        new Date().toISOString(),
    };
  }
}

function createExecutor(
  provider: AIProvider,
  options: ConstructorParameters<
    typeof AIExecutor
  >[1] = {},
): AIExecutor {
  const registry =
    new ProviderRegistry();

  registry.register(provider);

  const router =
    new AIRouter(registry);

  return new AIExecutor(
    router,
    options,
  );
}

function createRequest(
  overrides: Partial<AIRequest> = {},
): AIRequest {
  return {
    id:
      "request-execution-test",
    userId:
      "user-execution-test",
    taskType: "chat",
    prompt:
      "Test AI execution pipeline",
    mode: "balanced",
    createdAt:
      new Date().toISOString(),
    ...overrides,
  };
}

async function testSuccessfulExecution(): Promise<void> {
  const provider =
    new ExecutionTestProvider(
      "execution-test-provider",
      "Execution Test Provider",
    );

  const executor =
    createExecutor(provider);

  const request =
    createRequest({
      organizationId:
        "org-execution-test",
    });

  const submittedIds: string[] = [];

  const result =
    await executor.execute({
      request,
      context: {
        requestId: request.id,
        userId: request.userId,
        ...(request.organizationId !== undefined
          ? {
              organizationId:
                request.organizationId,
            }
          : {}),
        onSubmitted:
          async (
            providerRequestId,
          ) => {
            submittedIds.push(
              providerRequestId,
            );
          },
      },
    });

  assertEqual(
    result.response.success,
    true,
    "Successful execution should succeed",
  );

  assertEqual(
    result.providerId,
    "execution-test-provider",
    "Executed provider should match",
  );

  assertEqual(
    result.routing.provider.providerId,
    "execution-test-provider",
    "Routing provider should match",
  );

  assertEqual(
    provider.generateCalls,
    1,
    "Provider should execute once",
  );

  assertEqual(
    submittedIds.length,
    1,
    "onSubmitted should be called once",
  );

  assertEqual(
    submittedIds[0],
    "execution-test-provider-request-1",
    "Submitted provider request id should match",
  );

  assertEqual(
    provider.submittedRequestIds[0],
    submittedIds[0],
    "Provider and executor submission IDs should match",
  );
}

async function testOptionalOrganizationContext(): Promise<void> {
  const provider =
    new ExecutionTestProvider(
      "optional-org-provider",
      "Optional Organization Provider",
    );

  const executor =
    createExecutor(provider);

  const request =
    createRequest({
      id:
        "request-without-organization",
    });

  const result =
    await executor.execute({
      request,
      context: {
        requestId: request.id,
        userId: request.userId,
      },
    });

  assertEqual(
    result.response.success,
    true,
    "Execution without organization should succeed",
  );

  assertEqual(
    result.response.requestId,
    request.id,
    "Response request ID should match",
  );
}

async function testTimeoutAbortsProviderAttempt(): Promise<void> {
  let generateCalls = 0;
  let abortObserved = 0;
  let submittedCalls = 0;

  const provider: AIProvider = {
    providerId:
      "timeout-abort-provider",
    providerName:
      "Timeout Abort Provider",
    status:
      "active",
    capabilities:
      ["chat"],

    supports(
      taskType: AITaskType,
    ): boolean {
      return taskType === "chat";
    },

    supportsCapability(
      capability: "chat",
    ): boolean {
      return capability === "chat";
    },

    async generate<T = unknown>(
      _input: AIProviderRequest,
      context: AIProviderContext,
    ): Promise<AIResponse<T>> {
      generateCalls += 1;

      await new Promise<void>(
        (resolve) => {
          setTimeout(
            resolve,
            30,
          );
        },
      );

      if (
        context.signal?.aborted
      ) {
        abortObserved += 1;

        return {
          requestId:
            context.requestId,
          success: false,
          errorCode:
            "TEST_ABORTED_AFTER_TIMEOUT",
          errorMessage:
            "Provider observed an aborted attempt.",
          createdAt:
            new Date().toISOString(),
        };
      }

      submittedCalls += 1;

      if (
        context.onSubmitted !==
        undefined
      ) {
        await context.onSubmitted(
          `${this.providerId}-request-${generateCalls}`,
        );
      }

      return {
        requestId:
          context.requestId,
        success: true,
        result:
          {} as T,
        createdAt:
          new Date().toISOString(),
      };
    },
  };

  const executor =
    createExecutor(
      provider,
      {
        timeoutMs:
          10,
        retryCount:
          1,
        fallbackEnabled:
          false,
      },
    );

  const request =
    createRequest({
      id:
        "request-timeout-abort-provider",
    });

  const result =
    await executor.execute({
      request,
      context: {
        requestId:
          request.id,
        userId:
          request.userId,
      },
    });

  await new Promise<void>(
    (resolve) =>
      setTimeout(
        resolve,
        80,
      ),
  );

  assertEqual(
    result.response.success,
    false,
    "Timeout-abort execution should fail",
  );

  assertEqual(
    result.response.errorCode,
    "PROVIDER_TIMEOUT",
    "Timeout-abort should preserve timeout code",
  );

  assertEqual(
    generateCalls,
    2,
    "Configured timeout retry should still execute twice",
  );

  assertEqual(
    abortObserved,
    2,
    "Every timed-out provider attempt must observe abort",
  );

  assertEqual(
    submittedCalls,
    0,
    "Aborted provider attempts must not submit requests",
  );
}
async function testTimeoutRetries(): Promise<void> {
  const provider =
    new ExecutionTestProvider(
      "timeout-provider",
      "Timeout Provider",
      {
        delayMs: 50,
      },
    );

  const executor =
    createExecutor(
      provider,
      {
        timeoutMs: 10,
        retryCount: 1,
        fallbackEnabled: false,
      },
    );

  const request =
    createRequest({
      id:
        "request-timeout",
      organizationId:
        "org-timeout",
    });

  const result =
    await executor.execute({
      request,
      context: {
        requestId: request.id,
        userId: request.userId,
        ...(request.organizationId !== undefined
          ? {
              organizationId:
                request.organizationId,
            }
          : {}),
      },
    });

  assertEqual(
    result.response.success,
    false,
    "Timed out execution should fail",
  );

  assertEqual(
    result.response.errorCode,
    "PROVIDER_TIMEOUT",
    "Timeout should normalize correctly",
  );

  assertEqual(
    provider.generateCalls,
    2,
    "Configured retry should execute twice",
  );

  assertEqual(
    result.attempts.length,
    2,
    "Two timeout attempts should be recorded",
  );

  assertCondition(
    result.attempts.every(
      (attempt) =>
        attempt.errorCode ===
        "PROVIDER_TIMEOUT",
    ),
    "All timeout attempts should have PROVIDER_TIMEOUT",
  );
}

async function testAbortDoesNotRetry(): Promise<void> {
  const provider =
    new ExecutionTestProvider(
      "abort-provider",
      "Abort Provider",
      {
        delayMs: 100,
      },
    );

  const executor =
    createExecutor(
      provider,
      {
        timeoutMs: 1_000,
        retryCount: 3,
        fallbackEnabled: false,
      },
    );

  const request =
    createRequest({
      id:
        "request-abort",
      organizationId:
        "org-abort",
    });

  const controller =
    new AbortController();

  const execution =
    executor.execute({
      request,
      context: {
        requestId: request.id,
        userId: request.userId,
        ...(request.organizationId !== undefined
          ? {
              organizationId:
                request.organizationId,
            }
          : {}),
      },
      signal:
        controller.signal,
    });

  setTimeout(
    () => controller.abort(),
    10,
  );

  let caught = false;

  try {
    await execution;
  } catch (error) {
    caught =
      error instanceof Error &&
      error.message ===
        "AI provider execution aborted.";
  }

  assertCondition(
    caught,
    "Explicit abort should reject with abort error",
  );

  assertEqual(
    provider.generateCalls,
    1,
    "Explicit abort must not trigger retry",
  );
}

async function testProviderFailureIsRecorded(): Promise<void> {
  const provider =
    new ExecutionTestProvider(
      "failure-provider",
      "Failure Provider",
      {
        fail: true,
      },
    );

  const executor =
    createExecutor(
      provider,
      {
        retryCount: 0,
        fallbackEnabled: false,
      },
    );

  const request =
    createRequest({
      id:
        "request-provider-failure",
      organizationId:
        "org-provider-failure",
    });

  const result =
    await executor.execute({
      request,
      context: {
        requestId: request.id,
        userId: request.userId,
        ...(request.organizationId !== undefined
          ? {
              organizationId:
                request.organizationId,
            }
          : {}),
      },
    });

  assertEqual(
    result.response.success,
    false,
    "Provider failure should return unsuccessful response",
  );

  assertEqual(
    result.response.errorCode,
    "TEST_PROVIDER_FAILURE",
    "Provider failure code should be preserved",
  );

  assertEqual(
    result.attempts.length,
    1,
    "One attempt should be recorded",
  );

  assertEqual(
    result.attempts[0]?.success,
    false,
    "Failed provider attempt should be marked unsuccessful",
  );
}

async function testRequestTimeoutOverride(): Promise<void> {
  const provider =
    new ExecutionTestProvider(
      "override-timeout-provider",
      "Override Timeout Provider",
      {
        delayMs: 25,
      },
    );

  const executor =
    createExecutor(
      provider,
      {
        timeoutMs: 1_000,
        retryCount: 0,
        fallbackEnabled: false,
      },
    );

  const request =
    createRequest({
      id:
        "request-timeout-override",
      organizationId:
        "org-timeout-override",
    });

  const result =
    await executor.execute({
      request,
      context: {
        requestId: request.id,
        userId: request.userId,
        ...(request.organizationId !== undefined
          ? {
              organizationId:
                request.organizationId,
            }
          : {}),
      },
      timeoutMs: 5,
    });

  assertEqual(
    result.response.success,
    false,
    "Request-level timeout should fail execution",
  );

  assertEqual(
    result.response.errorCode,
    "PROVIDER_TIMEOUT",
    "Request-level timeout should normalize correctly",
  );
}


async function testSubmissionPreventsDuplicateRetry(): Promise<void> {
  const provider =
    new ExecutionTestProvider(
      "submission-failure-provider",
      "Submission Failure Provider",
      {
        fail: true,
      },
    );

  const executor =
    createExecutor(
      provider,
      {
        retryCount: 3,
        fallbackEnabled: false,
      },
    );

  const request =
    createRequest({
      id:
        "request-submission-failure",
      organizationId:
        "org-submission-failure",
    });

  const submittedIds: string[] = [];

  const result =
    await executor.execute({
      request,
      context: {
        requestId:
          request.id,
        userId:
          request.userId,
        ...(request.organizationId !== undefined
          ? {
              organizationId:
                request.organizationId,
            }
          : {}),
        onSubmitted:
          async (
            providerRequestId,
          ) => {
            submittedIds.push(
              providerRequestId,
            );
          },
      },
    });

  assertEqual(
    result.response.success,
    false,
    "Submitted provider failure should remain unsuccessful",
  );

  assertEqual(
    provider.generateCalls,
    1,
    "Submitted provider request must not be retried",
  );

  assertEqual(
    submittedIds.length,
    1,
    "Provider submission callback should execute once",
  );

  assertEqual(
    result.submittedProviderRequestId,
    submittedIds[0],
    "Submitted provider request ID must be preserved",
  );
}

async function testLateSubmissionAfterTimeoutPreventsDuplicateRetry(): Promise<void> {
  let generateCalls = 0;
  let submissionCalls = 0;

  const provider: AIProvider = {
    providerId: "late-submission-provider",
    providerName: "Late Submission Provider",
    status: "active",
    capabilities: ["chat"],

    supports(
      taskType: AITaskType,
    ): boolean {
      return taskType === "chat";
    },

    supportsCapability(
      capability: "chat",
    ): boolean {
      return capability === "chat";
    },

    async generate<T = unknown>(
      _input: AIProviderRequest,
      context: AIProviderContext,
    ): Promise<AIResponse<T>> {
      generateCalls += 1;

      await new Promise<void>(
        (resolve) => {
          setTimeout(resolve, 35);
        },
      );

      submissionCalls += 1;

      if (context.onSubmitted !== undefined) {
        await context.onSubmitted(
          `late-provider-request-${generateCalls}`,
        );
      }

      return {
        requestId: context.requestId,
        success: true,
        result: {} as T,
        createdAt: new Date().toISOString(),
      };
    },
  };

  const executor = createExecutor(
    provider,
    {
      timeoutMs: 10,
      retryCount: 3,
      fallbackEnabled: false,
    },
  );

  const request = createRequest({
    id: "request-late-submission-race",
  });

  const result = await executor.execute({
    request,
    context: {
      requestId: request.id,
      userId: request.userId,
    },
  });

  assertEqual(
    result.response.success,
    false,
    "Late submission after timeout should not become success",
  );

  assertEqual(
    result.response.errorCode,
    "PROVIDER_TIMEOUT",
    "Late submission race should preserve timeout classification",
  );

  assertEqual(
    generateCalls,
    1,
    "A late provider submission after timeout must prevent duplicate retry",
  );

  assertEqual(
    submissionCalls,
    1,
    "Only the original provider attempt may submit",
  );

  assertEqual(
    result.submittedProviderRequestId,
    "late-provider-request-1",
    "Late provider request ID must be preserved",
  );
}
await testSuccessfulExecution();
console.log(
  "âœ” successful execution + onSubmitted",
);

await testSubmissionPreventsDuplicateRetry();
console.log(
  "âœ” submission prevents duplicate retry",
);

await testOptionalOrganizationContext();
console.log(
  "âœ” optional organization context",
);

await testTimeoutAbortsProviderAttempt();
console.log(
  "âœ” timeout aborts provider attempt",
);
await testTimeoutRetries();
console.log(
  "âœ” timeout retries",
);

await testAbortDoesNotRetry();
console.log(
  "âœ” abort does not retry",
);

await testProviderFailureIsRecorded();
console.log(
  "âœ” provider failure normalization",
);

await testRequestTimeoutOverride();
console.log(
  "âœ” per-request timeout override",
);

console.log(
  "AI execution regression tests passed.",
);
