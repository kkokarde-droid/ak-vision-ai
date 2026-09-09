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
  organizationId?: string;
  onSubmitted?: (
    providerRequestId: string,
  ) => Promise<void>;
  onProviderSubmitted?: (
    providerRequestId: string,
    providerId: string,
  ) => Promise<void>;
}

export interface AIExecutionRequest {
  request: AIRequest;
  context: AIExecutionContext;
  signal?: AbortSignal;
  timeoutMs?: number;
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
  submittedProviderRequestId?: string;
}

const SUBMISSION_OBSERVATION_GRACE_MS = 250;
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


    let submittedProviderRequestId:

      | string

      | undefined;


    let haltAfterSubmission =

      false;

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

        const attemptController =
          new AbortController();
        const attemptSignal =
          attemptController.signal;
        const providerContext: AIProviderContext = {
          requestId: input.context.requestId,
          userId: input.context.userId,
          ...(input.context.organizationId !== undefined
            ? {
                organizationId:
                  input.context.organizationId,
              }
            : {}),
          signal:
            attemptSignal,
          ...(input.context.onSubmitted !== undefined ||
          input.context.onProviderSubmitted !== undefined
            ? {
                onSubmitted: async (
                  providerRequestId,
                ) => {
                  submittedProviderRequestId =
                    providerRequestId;

                  if (
                    input.context.onSubmitted !==
                    undefined
                  ) {
                    await input.context.onSubmitted(
                      providerRequestId,
                    );
                  }

                  if (
                    input.context.onProviderSubmitted !==
                    undefined
                  ) {
                    await input.context.onProviderSubmitted(
                      providerRequestId,
                      provider.providerId,
                    );
                  }
                },
              }
            : {}),
        };

        const startedAt = Date.now();

        const providerExecution =
          provider.generate<T>(
            providerRequest,
            providerContext,
          );

        try {
          const response = await this.executeWithTimeout<T>(
            providerExecution,
            input.timeoutMs ??
              this.options.timeoutMs,
            attemptController,
            input.signal,
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
              ...(submittedProviderRequestId !== undefined
                ? {
                    submittedProviderRequestId,
                  }
                : {}),
            };
          }

          lastErrorCode =
            response.errorCode ?? "PROVIDER_EXECUTION_FAILED";

          lastErrorMessage =
            response.errorMessage ??
            "AI provider returned an unsuccessful response.";

          if (
            submittedProviderRequestId !==
            undefined
          ) {
            haltAfterSubmission = true;
          }
        } catch (error) {
          if (input.signal?.aborted) {
            throw new Error(
              "AI provider execution aborted.",
            );
          }

          const durationMs = Date.now() - startedAt;

          const errorMessage =
            error instanceof Error
              ? error.message
              : "Unknown provider execution error.";

          const timedOut =
            errorMessage ===
            "AI provider execution timed out.";

          const errorCode =
            timedOut
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

          /*
           * Timeout/submission race protection:
           *
           * A provider request can be submitted after our timeout
           * boundary. Retrying before resolving that state can create
           * a duplicate provider request.
           *
           * Rules:
           *   - submission observed => never retry
           *   - attempt settles without submission => normal retry
           *   - attempt remains unresolved => never retry because the
           *     external submission state is uncertain
           */
          if (timedOut) {
            if (
              submittedProviderRequestId ===
              undefined
            ) {
              const settled =
                await this.waitForAttemptSettlement(
                  providerExecution,
                  SUBMISSION_OBSERVATION_GRACE_MS,
                );

              if (
                submittedProviderRequestId !==
                undefined
              ) {
                haltAfterSubmission = true;
              } else if (!settled) {
                haltAfterSubmission = true;
              }
            } else {
              haltAfterSubmission = true;
            }
          } else if (
            submittedProviderRequestId !==
            undefined
          ) {
            haltAfterSubmission = true;
          }
        }
      if (haltAfterSubmission) {
        break;
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
      ...(submittedProviderRequestId !== undefined
        ? {
            submittedProviderRequestId,
          }
        : {}),
    };
  }  private async waitForAttemptSettlement(
    promise: Promise<unknown>,
    graceMs: number,
  ): Promise<boolean> {
    let timer:
      | ReturnType<typeof setTimeout>
      | undefined;

    const settledPromise =
      promise.then(
        () => true,
        () => true,
      );

    const timeoutPromise =
      new Promise<boolean>(
        (resolve) => {
          timer = setTimeout(
            () => resolve(false),
            graceMs,
          );
        },
      );

    try {
      return await Promise.race([
        settledPromise,
        timeoutPromise,
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async executeWithTimeout<T>(
    promise: Promise<AIResponse<T>>,
    timeoutMs: number,
    attemptController: AbortController,
    externalSignal?: AbortSignal,
  ): Promise<AIResponse<T>> {
    let timeoutHandle:
      | ReturnType<typeof setTimeout>
      | undefined;

    let abortHandler:
      | (() => void)
      | undefined;

    let externalAbortHandler:
      | (() => void)
      | undefined;

    let timedOut = false;

    const timeoutPromise =
      new Promise<AIResponse<T>>(
        (_, reject) => {
          timeoutHandle =
            setTimeout(() => {
              /*
               * Timeout owns the terminal error classification.
               * Abort the provider attempt before allowing retry.
               */
              timedOut = true;
              attemptController.abort();

              reject(
                new Error(
                  "AI provider execution timed out.",
                ),
              );
            }, timeoutMs);
        },
      );

    const abortPromise =
      new Promise<AIResponse<T>>(
        (_, reject) => {
          const signal =
            attemptController.signal;

          abortHandler = () => {
            if (timedOut) {
              return;
            }

            reject(
              new Error(
                "AI provider execution aborted.",
              ),
            );
          };

          if (signal.aborted) {
            abortHandler();
            return;
          }

          signal.addEventListener(
            "abort",
            abortHandler,
            {
              once: true,
            },
          );
        },
      );

    if (
      externalSignal !== undefined
    ) {
      externalAbortHandler = () => {
        attemptController.abort();
      };

      if (
        externalSignal.aborted
      ) {
        attemptController.abort();
      } else {
        externalSignal.addEventListener(
          "abort",
          externalAbortHandler,
          {
            once: true,
          },
        );
      }
    }

    try {
      return await Promise.race([
        promise,
        timeoutPromise,
        abortPromise,
      ]);
    } finally {
      if (
        timeoutHandle !==
        undefined
      ) {
        clearTimeout(
          timeoutHandle,
        );
      }

      if (abortHandler) {
        attemptController.signal.removeEventListener(
          "abort",
          abortHandler,
        );
      }

      if (
        externalSignal !== undefined &&
        externalAbortHandler !==
          undefined
      ) {
        externalSignal.removeEventListener(
          "abort",
          externalAbortHandler,
        );
      }
    }
  }
}
