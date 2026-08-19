import type {
  AIRequest,
  AIResponse,
} from "@ak-vision-ai/types";
import type {
  AIProviderContext,
  AIProviderRequest,
} from "./provider.js";
import type {
  AIRoutingDecision,
  AIRouter,
} from "./router.js";

export interface AIExecutionContext {
  requestId: string;
  userId: string;
  organizationId: string;
}

export interface AIExecutionRequest {
  request: AIRequest;
  context: AIExecutionContext;
}

export interface AIExecutionOptions {
  timeoutMs?: number;
  retryCount?: number;
  fallbackEnabled?: boolean;
}

export interface AIExecutionAttempt {
  providerId: string;
  providerName: string;
  attempt: number;
  durationMs: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface AIExecutionResult<T = unknown> {
  response: AIResponse<T>;
  providerId: string;
  providerName: string;
  routing: AIRoutingDecision;
  attempts: AIExecutionAttempt[];
  fallbackUsed: boolean;
}

export class AIExecutor {
  private readonly options: Required<AIExecutionOptions>;

  constructor(
    private readonly router: AIRouter,
    options: AIExecutionOptions = {},
  ) {
    this.options = {
      timeoutMs: options.timeoutMs ?? 60_000,
      retryCount: options.retryCount ?? 1,
      fallbackEnabled: options.fallbackEnabled ?? true,
    };
  }

  async execute<T = unknown>(
    input: AIExecutionRequest,
  ): Promise<AIExecutionResult<T>> {
    const routing = this.router.route({
      request: input.request,
      taskType: input.request.taskType,
    });

    const candidates = this.options.fallbackEnabled
      ? routing.candidates
      : routing.candidates.slice(0, 1);

    const attempts: AIExecutionAttempt[] = [];

    let attemptNumber = 0;
    let lastErrorCode = "PROVIDER_EXECUTION_FAILED";
    let lastErrorMessage = "AI provider execution failed.";

    for (
      let candidateIndex = 0;
      candidateIndex < candidates.length;
      candidateIndex += 1
    ) {
      const candidate = candidates[candidateIndex];

      if (!candidate) {
        continue;
      }

      const provider = candidate.provider;
      const maxAttempts = this.options.retryCount + 1;

      for (
        let providerAttempt = 1;
        providerAttempt <= maxAttempts;
        providerAttempt += 1
      ) {
        attemptNumber += 1;

        const providerRequest: AIProviderRequest = {
          request: input.request,
          taskType: input.request.taskType,
        };

        const providerContext: AIProviderContext = {
          requestId: input.context.requestId,
          userId: input.context.userId,
          organizationId: input.context.organizationId,
        };

        const startedAt = Date.now();

        try {
          const response = await this.executeWithTimeout<T>(
            provider.generate<T>(
              providerRequest,
              providerContext,
            ),
            this.options.timeoutMs,
          );

          const durationMs = Date.now() - startedAt;

          const attempt: AIExecutionAttempt = {
            providerId: provider.providerId,
            providerName: provider.providerName,
            attempt: attemptNumber,
            durationMs,
            success: response.success,
          };

          if (response.errorCode !== undefined) {
            attempt.errorCode = response.errorCode;
          }

          if (response.errorMessage !== undefined) {
            attempt.errorMessage = response.errorMessage;
          }

          attempts.push(attempt);

          if (response.success) {
            return {
              response: {
                ...response,
                usage: {
                  ...response.usage,
                  durationMs,
                },
              },
              providerId: provider.providerId,
              providerName: provider.providerName,
              routing,
              attempts,
              fallbackUsed: candidateIndex > 0,
            };
          }

          lastErrorCode =
            response.errorCode ?? "PROVIDER_EXECUTION_FAILED";

          lastErrorMessage =
            response.errorMessage ??
            "AI provider returned an unsuccessful response.";
        } catch (error) {
          const durationMs = Date.now() - startedAt;

          const errorMessage =
            error instanceof Error
              ? error.message
              : "Unknown provider execution error.";

          const errorCode =
            errorMessage === "AI provider execution timed out."
              ? "PROVIDER_TIMEOUT"
              : "PROVIDER_EXECUTION_FAILED";

          attempts.push({
            providerId: provider.providerId,
            providerName: provider.providerName,
            attempt: attemptNumber,
            durationMs,
            success: false,
            errorCode,
            errorMessage,
          });

          lastErrorCode = errorCode;
          lastErrorMessage = errorMessage;
        }
      }
    }

    const totalDurationMs = attempts.reduce(
      (total, attempt) => total + attempt.durationMs,
      0,
    );

    return {
      response: {
        requestId: input.context.requestId,
        success: false,
        errorCode: lastErrorCode,
        errorMessage: lastErrorMessage,
        usage: {
          durationMs: totalDurationMs,
        },
        createdAt: new Date().toISOString(),
      },
      providerId: routing.provider.providerId,
      providerName: routing.provider.providerName,
      routing,
      attempts,
      fallbackUsed: attempts.some(
        (attempt) =>
          attempt.providerId !== routing.provider.providerId,
      ),
    };
  }

  private async executeWithTimeout<T>(
    promise: Promise<AIResponse<T>>,
    timeoutMs: number,
  ): Promise<AIResponse<T>> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<AIResponse<T>>(
      (_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error("AI provider execution timed out."),
          );
        }, timeoutMs);
      },
    );

    try {
      return await Promise.race([
        promise,
        timeoutPromise,
      ]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
