import {
  claimNextGenerationJob,
  completeGenerationJob,
  failGenerationJob,
  heartbeatGenerationJob,
  updateGenerationProgress,
} from "@ak-vision-ai/generation";

import type { GenerationJob } from "@ak-vision-ai/database";

import {
  releaseOwnedCreditReservation,
} from "@ak-vision-ai/credits";

import type { GenerationProcessor } from "./processor.js";

export type WorkerOptions = {
  workerId: string;
  leaseMs?: number;
  heartbeatMs?: number;
  logger?: WorkerLogger;
};

export type WorkerLogger = {
  error(message: string, error?: unknown): void;
  warn(message: string, error?: unknown): void;
};

export type GenerationWorkerPorts = {
  claimNextGenerationJob: (
    workerId: string,
    leaseMs?: number,
  ) => Promise<GenerationJob | null>;

  completeGenerationJob: (
    jobId: string,
    workerId: string,
    output: Record<string, unknown>,
  ) => Promise<unknown>;

  failGenerationJob: (
    jobId: string,
    workerId: string,
    input: {
      errorCode: string;
      errorMessage: string;
      retryDelayMs?: number;
      retryable?: boolean;
    },
  ) => Promise<
    Pick<
      GenerationJob,
      "status" |
        "creditReservationId" |
        "userId" |
        "organizationId"
    > | void
  >;

  heartbeatGenerationJob: (
    jobId: string,
    workerId: string,
    leaseMs?: number,
  ) => Promise<unknown>;

  updateGenerationProgress: (
    jobId: string,
    workerId: string,
    progress: number,
  ) => Promise<unknown>;

  releaseCreditReservation: (
    reservationId: string,
    owner: {
      userId?: string;
      organizationId?: string;
    },
  ) => Promise<unknown>;
};

const defaultPorts: GenerationWorkerPorts = {
  claimNextGenerationJob,
  completeGenerationJob,
  failGenerationJob,
  heartbeatGenerationJob,
  updateGenerationProgress,

  releaseCreditReservation:
    async (
      reservationId,
      owner,
    ) =>
      releaseOwnedCreditReservation(
        {
          reservationId,
        },
        owner,
      ),
};

const defaultLogger: WorkerLogger = {
  error(message, error) {
    console.error(message, error);
  },

  warn(message, error) {
    console.warn(message, error);
  },
};

export class GenerationWorker {
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly logger: WorkerLogger;
  private readonly ports: GenerationWorkerPorts;
  private readonly processor: GenerationProcessor;

  private running = false;
  private stopping = false;

  private activeController: AbortController | null = null;
  private startPromise: Promise<void> | null = null;

  constructor(
    processor: GenerationProcessor,
    options: WorkerOptions,
    ports: GenerationWorkerPorts = defaultPorts,
  ) {
    if (!options.workerId?.trim()) {
      throw new Error("workerId is required");
    }

    const leaseMs = options.leaseMs ?? 60_000;
    const heartbeatMs =
      options.heartbeatMs ??
      Math.max(1_000, Math.floor(leaseMs / 3));

    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }

    if (
      !Number.isInteger(heartbeatMs) ||
      heartbeatMs <= 0 ||
      heartbeatMs >= leaseMs
    ) {
      throw new Error(
        "heartbeatMs must be a positive integer smaller than leaseMs",
      );
    }

    this.workerId = options.workerId.trim();
    this.leaseMs = leaseMs;
    this.heartbeatMs = heartbeatMs;
    this.logger = options.logger ?? defaultLogger;
    this.processor = processor;
    this.ports = ports;
  }

  async runOnce(): Promise<boolean> {
    if (this.activeController) {
      throw new Error(
        "Generation worker is already processing a job",
      );
    }

    if (this.stopping) {
      return false;
    }

    const controller = new AbortController();
    this.activeController = controller;

    try {
      const job = await this.ports.claimNextGenerationJob(
        this.workerId,
        this.leaseMs,
      );

      if (!job) {
        return false;
      }

      if (this.stopping) {
        return true;
      }

      await this.processJob(job, controller);

      return true;
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }

  async start(pollMs = 1_000): Promise<void> {
    if (this.running || this.startPromise) {
      throw new Error(
        "Generation worker is already running",
      );
    }

    if (!Number.isInteger(pollMs) || pollMs <= 0) {
      throw new Error(
        "pollMs must be a positive integer",
      );
    }

    this.running = true;
    this.stopping = false;

    const promise = this.runLoop(pollMs);
    this.startPromise = promise;

    try {
      await promise;
    } finally {
      this.running = false;

      if (this.startPromise === promise) {
        this.startPromise = null;
      }
    }
  }

  stop(): void {
    this.stopping = true;
    this.running = false;

    const controller = this.activeController;

    if (controller && !controller.signal.aborted) {
      controller.abort(
        new Error(
          "Generation worker shutdown requested",
        ),
      );
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private async runLoop(pollMs: number): Promise<void> {
    while (this.running) {
      try {
        const processed = await this.runOnce();

        if (this.running && !processed) {
          await this.sleep(pollMs);
        }
      } catch (error) {
        this.logger.error(
          "Generation worker loop error",
          error,
        );

        if (this.running) {
          await this.sleep(pollMs);
        }
      }
    }
  }

  private async processJob(
    job: GenerationJob,
    controller: AbortController,
  ): Promise<void> {
    const heartbeatStopController =
      new AbortController();

    let leaseLost = false;
    let heartbeatFailureMessage: string | null = null;

    const heartbeatTask =
      this.runHeartbeatLoop(
        job,
        controller,
        heartbeatStopController.signal,
        (message) => {
          leaseLost = true;
          heartbeatFailureMessage = message;
        },
      );

    try {
      if (controller.signal.aborted) {
        return;
      }

      await this.ports.updateGenerationProgress(
        job.id,
        this.workerId,
        1,
      );

      if (controller.signal.aborted) {
        if (this.stopping) {
          return;
        }

        throw new Error(
          "Generation worker lost its lease",
        );
      }

      const result =
        await this.processor.process(
          job,
          controller.signal,
        );

      /*
       * Stop heartbeat creation before terminal state
       * transition and wait for any in-flight heartbeat.
       */
      heartbeatStopController.abort();
      await heartbeatTask;

      if (leaseLost) {
        throw new Error(
          heartbeatFailureMessage ??
            "Generation worker lost its lease",
        );
      }

      if (controller.signal.aborted) {
        if (this.stopping) {
          return;
        }

        throw new Error(
          "Generation worker lost its lease",
        );
      }

      await this.ports.updateGenerationProgress(
        job.id,
        this.workerId,
        99,
      );

      if (controller.signal.aborted) {
        if (this.stopping) {
          return;
        }

        throw new Error(
          "Generation worker lost its lease",
        );
      }

      await this.ports.completeGenerationJob(
        job.id,
        this.workerId,
        result.output,
      );
    } catch (error) {
      heartbeatStopController.abort();

      try {
        await heartbeatTask;
      } catch (heartbeatCleanupError) {
        this.logger.error(
          `Generation heartbeat cleanup failed for ${job.id}`,
          heartbeatCleanupError,
        );
      }

      /*
       * Controlled shutdown is not a generation failure.
       * Leave the claimed job for lease expiry/recovery.
       */
      if (
        this.stopping &&
        !leaseLost
      ) {
        this.logger.warn(
          `Generation job ${job.id} interrupted by worker shutdown; lease will expire.`,
        );

        return;
      }

      const normalizedError =
        this.toError(
          error,
          "Unknown generation worker error.",
        );

      const errorMetadata =
        normalizedError as Error & {
          code?: unknown;
          retryable?: unknown;
        };

      const errorCode =
        leaseLost
          ? "WORKER_LEASE_LOST"
          : typeof errorMetadata.code ===
              "string" &&
            errorMetadata.code.trim()
            ? errorMetadata.code
            : "GENERATION_PROCESSING_FAILED";

      const failureInput = {
        errorCode,
        errorMessage:
          heartbeatFailureMessage ??
          normalizedError.message,
        ...(typeof errorMetadata.retryable ===
        "boolean"
          ? {
              retryable:
                errorMetadata.retryable,
            }
          : {}),
      };

      try {
        const failedJob =
          await this.ports.failGenerationJob(
            job.id,
            this.workerId,
            failureInput,
          );

        if (failedJob && failedJob.status === "failed") {
          const owner =
            failedJob.organizationId
              ? {
                  organizationId:
                    failedJob.organizationId,
                }
              : {
                  userId:
                    failedJob.userId,
                };

          await this.ports.releaseCreditReservation(
            failedJob.creditReservationId,
            owner,
          );
        }
      } catch (failError) {
        this.logger.error(
          `Unable to persist failure for ${job.id}`,
          failError,
        );
      }
    } finally {
      heartbeatStopController.abort();

      try {
        await heartbeatTask;
      } catch (heartbeatCleanupError) {
        this.logger.error(
          `Generation heartbeat final cleanup failed for ${job.id}`,
          heartbeatCleanupError,
        );
      }
    }
  }

  private async runHeartbeatLoop(
    job: GenerationJob,
    controller: AbortController,
    stopSignal: AbortSignal,
    onLeaseLost: (message: string) => void,
  ): Promise<void> {
    while (
      !stopSignal.aborted &&
      !controller.signal.aborted
    ) {
      await this.sleep(
        this.heartbeatMs,
        stopSignal,
      );

      if (
        stopSignal.aborted ||
        controller.signal.aborted
      ) {
        return;
      }

      try {
        await this.ports.heartbeatGenerationJob(
          job.id,
          this.workerId,
          this.leaseMs,
        );
      } catch (error) {
        const message =
          this.toError(
            error,
            "Generation worker lease heartbeat failed.",
          ).message;

        onLeaseLost(message);

        this.logger.warn(
          `Worker lease heartbeat failed for ${job.id}`,
          error,
        );

        if (!controller.signal.aborted) {
          controller.abort(
            new Error(
              "Generation worker lost its lease",
            ),
          );
        }

        return;
      }
    }
  }
  private async sleep(
    durationMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      return;
    }

    await new Promise<void>((resolve) => {
      let completed = false;

      const timer = setTimeout(() => {
        finish();
      }, durationMs);

      const onAbort = (): void => {
        finish();
      };

      const finish = (): void => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timer);

        signal?.removeEventListener(
          "abort",
          onAbort,
        );

        resolve();
      };

      signal?.addEventListener(
        "abort",
        onAbort,
        { once: true },
      );
    });
  }

  private toError(
    error: unknown,
    fallback: string,
  ): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error(fallback);
  }
}
