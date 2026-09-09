import test from "node:test";
import assert from "node:assert/strict";

import type { GenerationJob } from "@ak-vision-ai/database";

import {
  GenerationWorker,
  type GenerationWorkerPorts,
} from "./worker.js";

import type {
  GenerationProcessor,
} from "./processor.js";

function createJob(): GenerationJob {
  return {
    id: "11111111-1111-4111-8111-111111111111",
  } as GenerationJob;
}

function createPorts(
  overrides: Partial<GenerationWorkerPorts> = {},
): GenerationWorkerPorts {
  return {
    claimNextGenerationJob:
      async () => createJob(),

    completeGenerationJob:
      async () => undefined,

    failGenerationJob:
      async () => undefined,

    heartbeatGenerationJob:
      async () => undefined,

    updateGenerationProgress:
      async () => undefined,

    releaseCreditReservation:
      async () => undefined,
    ...overrides,
  };
}

function createLogger() {
  return {
    error() {},
    warn() {},
  };
}

test(
  "runOnce returns false when no job is available",
  async () => {
    const processor: GenerationProcessor = {
      async process() {
        throw new Error("must not execute");
      },
    };

    const worker =
      new GenerationWorker(
        processor,
        {
          workerId: "worker-test",
          logger: createLogger(),
        },
        createPorts({
          claimNextGenerationJob:
            async () => null,
        }),
      );

    const processed =
      await worker.runOnce();

    assert.equal(
      processed,
      false,
    );
  },
);

test(
  "successful job progresses and completes",
  async () => {
    const progress: number[] = [];
    let completed = false;

    const processor: GenerationProcessor = {
      async process() {
        return {
          output: {
            assetId: "asset-1",
          },
        };
      },
    };

    const worker =
      new GenerationWorker(
        processor,
        {
          workerId: "worker-test",
          leaseMs: 1_000,
          heartbeatMs: 100,
          logger: createLogger(),
        },
        createPorts({
          updateGenerationProgress:
            async (
              _jobId,
              _workerId,
              value,
            ) => {
              progress.push(value);
            },

          completeGenerationJob:
            async () => {
              completed = true;
            },
        }),
      );

    const processed =
      await worker.runOnce();

    assert.equal(processed, true);
    assert.deepEqual(
      progress,
      [1, 99],
    );
    assert.equal(
      completed,
      true,
    );
  },
);

test(
  "processor failure persists generation failure",
  async () => {
    let failure:
      | {
          errorCode: string;
          errorMessage: string;
        }
      | undefined;

    const processor: GenerationProcessor = {
      async process() {
        throw new Error(
          "provider execution failed",
        );
      },
    };

    const worker =
      new GenerationWorker(
        processor,
        {
          workerId: "worker-test",
          logger: createLogger(),
        },
        createPorts({
          failGenerationJob:
            async (
              _jobId,
              _workerId,
              error,
            ) => {
              failure = error;
            },
        }),
      );

    await worker.runOnce();

    assert.equal(
      failure?.errorCode,
      "GENERATION_PROCESSING_FAILED",
    );

    assert.equal(
      failure?.errorMessage,
      "provider execution failed",
    );
  },
);

test(
  "heartbeat failure aborts processing and records lease loss",
  async () => {
    let failure:
      | {
          errorCode: string;
          errorMessage: string;
        }
      | undefined;

    const processor: GenerationProcessor = {
      async process(
        _job,
        signal,
      ) {
        await new Promise<void>(
          (resolve, reject) => {
            const timer =
              setTimeout(
                resolve,
                500,
              );

            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(
                  new Error(
                    "execution aborted",
                  ),
                );
              },
              { once: true },
            );
          },
        );

        return {
          output: {},
        };
      },
    };

    const worker =
      new GenerationWorker(
        processor,
        {
          workerId: "worker-test",
          leaseMs: 100,
          heartbeatMs: 10,
          logger: createLogger(),
        },
        createPorts({
          heartbeatGenerationJob:
            async () => {
              throw new Error(
                "database unavailable",
              );
            },

          failGenerationJob:
            async (
              _jobId,
              _workerId,
              error,
            ) => {
              failure = error;
            },
        }),
      );

    await worker.runOnce();

    assert.equal(
      failure?.errorCode,
      "WORKER_LEASE_LOST",
    );

    assert.equal(
      failure?.errorMessage,
      "database unavailable",
    );
  },
);

test(
  "controlled shutdown does not mark claimed job as failed",
  async () => {
    let failed = false;
    let worker: GenerationWorker | undefined;

    const processor: GenerationProcessor = {
      async process(_job, signal) {
        return new Promise<{
          output: Record<string, unknown>;
        }>((_resolve, reject) => {
          const onAbort = (): void => {
            signal.removeEventListener(
              "abort",
              onAbort,
            );

            reject(
              new Error("shutdown"),
            );
          };

          signal.addEventListener(
            "abort",
            onAbort,
            { once: true },
          );

          /*
           * Listener is registered BEFORE stop(), so there is
           * no missed abort event and therefore no hanging test.
           */
          worker?.stop();
        });
      },
    };

    worker =
      new GenerationWorker(
        processor,
        {
          workerId: "worker-test",
          leaseMs: 1_000,
          heartbeatMs: 100,
          logger: createLogger(),
        },
        createPorts({
          failGenerationJob:
            async () => {
              failed = true;
            },
        }),
      );

    await worker.runOnce();

    assert.equal(
      failed,
      false,
    );
  },
);

test(
  "propagates structured retryable=false provider failure",
  async () => {
    let failure:
      | {
          errorCode: string;
          errorMessage: string;
          retryable?: boolean;
        }
      | undefined;

    const processor: GenerationProcessor = {
      async process() {
        const error =
          new Error(
            "Provider request persistence failed.",
          ) as Error & {
            code?: string;
            retryable?: boolean;
          };

        error.code =
          "PROVIDER_REQUEST_PERSIST_FAILED";

        error.retryable =
          false;

        throw error;
      },
    };

    const worker =
      new GenerationWorker(
        processor,
        {
          workerId:
            "worker-test",
          logger:
            createLogger(),
        },
        createPorts({
          failGenerationJob:
            async (
              _jobId,
              _workerId,
              input,
            ) => {
              failure = input;
            },
        }),
      );

    await worker.runOnce();

    assert.equal(
      failure?.errorCode,
      "PROVIDER_REQUEST_PERSIST_FAILED",
    );

    assert.equal(
      failure?.errorMessage,
      "Provider request persistence failed.",
    );

    assert.equal(
      failure?.retryable,
      false,
    );
  },
);

test(
  "retryable generation failure keeps credits reserved",
  async () => {
    let releaseCalls = 0;

    const processor: GenerationProcessor = {
      async process() {
        const error =
          new Error(
            "temporary provider failure",
          ) as Error & {
            code?: string;
            retryable?: boolean;
          };

        error.code =
          "TEMPORARY_PROVIDER_ERROR";
        error.retryable =
          true;

        throw error;
      },
    };

    const worker =
      new GenerationWorker(
        processor,
        {
          workerId:
            "worker-test",
          logger:
            createLogger(),
        },
        createPorts({
          failGenerationJob:
            async (
              _jobId,
              _workerId,
              input,
            ) => {
              assert.equal(
                input.errorCode,
                "TEMPORARY_PROVIDER_ERROR",
              );

              assert.equal(
                input.retryable,
                true,
              );

              return {
                status: "queued",
                creditReservationId:
                  "reservation-retryable",
                userId:
                  "user-retryable",
                organizationId:
                  null,
              };
            },

          releaseCreditReservation:
            async () => {
              releaseCalls += 1;
            },
        }),
      );

    await worker.runOnce();

    assert.equal(
      releaseCalls,
      0,
    );
  },
);

test(
  "terminal generation failure releases reserved credits exactly once",
  async () => {
    let releaseCalls = 0;

    let releasedReservationId:
      | string
      | undefined;

    let releasedOwner:
      | {
          userId?: string;
          organizationId?: string;
        }
      | undefined;

    const processor: GenerationProcessor = {
      async process() {
        const error =
          new Error(
            "permanent provider failure",
          ) as Error & {
            code?: string;
            retryable?: boolean;
          };

        error.code =
          "PERMANENT_PROVIDER_ERROR";
        error.retryable =
          false;

        throw error;
      },
    };

    const worker =
      new GenerationWorker(
        processor,
        {
          workerId:
            "worker-test",
          logger:
            createLogger(),
        },
        createPorts({
          failGenerationJob:
            async (
              _jobId,
              _workerId,
              input,
            ) => {
              assert.equal(
                input.errorCode,
                "PERMANENT_PROVIDER_ERROR",
              );

              assert.equal(
                input.retryable,
                false,
              );

              return {
                status: "failed",
                creditReservationId:
                  "reservation-terminal",
                userId:
                  "user-terminal",
                organizationId:
                  null,
              };
            },

          releaseCreditReservation:
            async (
              reservationId,
              owner,
            ) => {
              releaseCalls += 1;
              releasedReservationId =
                reservationId;
              releasedOwner =
                owner;
            },
        }),
      );

    await worker.runOnce();

    assert.equal(
      releaseCalls,
      1,
    );

    assert.equal(
      releasedReservationId,
      "reservation-terminal",
    );

    assert.deepEqual(
      releasedOwner,
      {
        userId:
          "user-terminal",
      },
    );
  },
);