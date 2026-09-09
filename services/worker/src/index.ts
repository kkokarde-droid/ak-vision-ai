import os from "node:os";

import {
  GenerationWorker,
} from "./worker.js";

import {
  createDefaultGenerationProcessor,
} from "./processor.js";

function positiveIntegerEnv(
  name: string,
  fallback: number,
): number {
  const raw =
    process.env[name];

  if (
    raw === undefined ||
    raw.trim() === ""
  ) {
    return fallback;
  }

  const value =
    Number(raw);

  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `${name} must be a positive integer`,
    );
  }

  return value;
}

const workerId =
  process.env.WORKER_ID?.trim() ||
  `${os.hostname()}:${process.pid}`;

const leaseMs =
  positiveIntegerEnv(
    "GENERATION_WORKER_LEASE_MS",
    60_000,
  );

const heartbeatMs =
  positiveIntegerEnv(
    "GENERATION_WORKER_HEARTBEAT_MS",
    Math.max(
      1_000,
      Math.floor(
        leaseMs / 3,
      ),
    ),
  );

const pollMs =
  positiveIntegerEnv(
    "GENERATION_WORKER_POLL_MS",
    1_000,
  );

if (
  heartbeatMs >= leaseMs
) {
  throw new Error(
    "GENERATION_WORKER_HEARTBEAT_MS must be smaller than GENERATION_WORKER_LEASE_MS",
  );
}

if (
  !process.env.HF_CREDENTIALS?.trim()
) {
  throw new Error(
    "HF_CREDENTIALS is required for the V1 generation worker.",
  );
}

const processor =
  createDefaultGenerationProcessor(
    workerId,
  );

const worker =
  new GenerationWorker(
    processor,
    {
      workerId,
      leaseMs,
      heartbeatMs,
    },
  );

let shuttingDown = false;
let startPromise:
  | Promise<void>
  | undefined;

const shutdown =
  async (
    reason: string,
  ): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    console.log(
      `Generation worker shutdown requested: ${reason}`,
    );

    worker.stop();

    try {
      await startPromise;
    } catch (error) {
      console.error(
        "Generation worker shutdown failed",
        error,
      );
      process.exitCode = 1;
    }
  };

process.once(
  "SIGINT",
  () => {
    void shutdown("SIGINT");
  },
);

process.once(
  "SIGTERM",
  () => {
    void shutdown("SIGTERM");
  },
);

console.log(
  `AK Vision AI generation worker starting: ${workerId}`,
);

startPromise =
  worker.start(
    pollMs,
  );

void startPromise.catch(
  (error: unknown) => {
    console.error(
      "AK Vision AI generation worker failed",
      error,
    );
    process.exitCode = 1;
  },
);