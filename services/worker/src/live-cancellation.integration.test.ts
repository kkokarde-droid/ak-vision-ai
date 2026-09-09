import { after as afterPoolCleanup } from "node:test";
import { pool as testPoolCleanup } from "@ak-vision-ai/database";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  db,
  users,
  creditBalances,
  creditReservations,
  creditTransactions,
  generationJobs,
  usageRecords,
} from "@ak-vision-ai/database";

import {
  reserveCredit,
} from "@ak-vision-ai/credits";

import {
  cancelGenerationJob,
  createGenerationJob,
} from "@ak-vision-ai/generation";

import type {
  GenerationProcessor,
} from "./processor.js";

import {
  GenerationWorker,
} from "./worker.js";

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise<void>((resolve) =>
      setTimeout(resolve, intervalMs),
    );
  }

  throw new Error(
    "Timed out waiting for expected worker state.",
  );
}

async function createFixture(): Promise<{
  userId: string;
  balanceId: string;
  reservationId: string;
  jobId: string;
}> {
  const userResult = await db
    .insert(users)
    .values({
      email:
        `live-cancel-${randomUUID()}@example.test`,
      displayName:
        "Live Worker Cancellation Test",
      role: "customer",
      status: "active",
      accountType: "individual",
    })
    .returning({
      id: users.id,
    });

  const user = userResult[0];
  assert.ok(user);

  const balanceResult = await db
    .insert(creditBalances)
    .values({
      userId: user.id,
      organizationId: null,
      availableCredits: 100,
      reservedCredits: 0,
      currency: "INR",
    })
    .returning({
      id: creditBalances.id,
    });

  const balance = balanceResult[0];
  assert.ok(balance);

  const reservation = await reserveCredit({
    userId: user.id,
    amount: 10,
    idempotencyKey:
      `live-cancel-reservation-${randomUUID()}`,
    referenceId:
      `live-cancel-${randomUUID()}`,
  });

  assert.ok(reservation);

  const job = await createGenerationJob({
    requestId: randomUUID(),
    userId: user.id,
    creditReservationId: reservation.id,
    type: "video",
    priority: "normal",
    providerId:
      "live-cancellation-provider",
    prompt:
      "Live worker cancellation integration test",
    input: {
      integration:
        "live-cancellation",
    },
    maxAttempts: 3,
  });

  assert.ok(job);

  return {
    userId: user.id,
    balanceId: balance.id,
    reservationId: reservation.id,
    jobId: job.id,
  };
}

async function cleanupFixture(
  fixture: {
    userId: string;
    reservationId: string;
  },
): Promise<void> {
  const { eq } = await import("drizzle-orm");

  await db.transaction(async (tx) => {
    await tx
      .delete(usageRecords)
      .where(
        eq(
          usageRecords.reservationId,
          fixture.reservationId,
        ),
      );

    await tx
      .delete(creditTransactions)
      .where(
        eq(
          creditTransactions.reservationId,
          fixture.reservationId,
        ),
      );

    await tx
      .delete(generationJobs)
      .where(
        eq(
          generationJobs.userId,
          fixture.userId,
        ),
      );

    await tx
      .delete(creditReservations)
      .where(
        eq(
          creditReservations.id,
          fixture.reservationId,
        ),
      );

    await tx
      .delete(creditBalances)
      .where(
        eq(
          creditBalances.userId,
          fixture.userId,
        ),
      );

    await tx
      .delete(users)
      .where(
        eq(
          users.id,
          fixture.userId,
        ),
      );
  });
}

test(
  "live worker observes DB cancellation through heartbeat lease loss and aborts without completion or settlement",
  async () => {
    const fixture = await createFixture();

    let processorStartedResolve:
      | (() => void)
      | undefined;

    const processorStarted =
      new Promise<void>((resolve) => {
        processorStartedResolve = resolve;
      });

    let abortObserved = false;

    const processor:
      GenerationProcessor = {
      async process(_job, signal) {
        processorStartedResolve?.();

        return new Promise<{
          output: Record<string, unknown>;
        }>((_resolve, reject) => {
          const onAbort = (): void => {
            abortObserved = true;

            signal.removeEventListener(
              "abort",
              onAbort,
            );

            reject(
              new Error(
                "execution aborted by live cancellation",
              ),
            );
          };

          if (signal.aborted) {
            onAbort();
            return;
          }

          signal.addEventListener(
            "abort",
            onAbort,
            { once: true },
          );
        });
      },
    };

    const worker =
      new GenerationWorker(
        processor,
        {
          workerId:
            "worker-live-cancellation-e2e",
          leaseMs: 200,
          heartbeatMs: 50,
          logger: {
            error() {},
            warn() {},
          },
        },
      );

    try {
      const runPromise =
        worker.runOnce();

      await processorStarted;

      await waitFor(async () => {
        const { eq } =
          await import("drizzle-orm");

        const result = await db
          .select({
            status:
              generationJobs.status,
            lockedBy:
              generationJobs.lockedBy,
          })
          .from(generationJobs)
          .where(
            eq(
              generationJobs.id,
              fixture.jobId,
            ),
          )
          .limit(1);

        return (
          result[0]?.status === "processing" &&
          result[0]?.lockedBy ===
            "worker-live-cancellation-e2e"
        );
      });

      /*
       * This deliberately exercises the generation repository
       * cancellation boundary. Credit release is separately
       * owned by the API cancellation transaction and is already
       * covered by the cancellation E2E suite.
       */
      const cancelled =
        await cancelGenerationJob(
          fixture.jobId,
          {
            userId: fixture.userId,
          },
        );

      assert.equal(
        cancelled.status,
        "cancelled",
      );

      await runPromise;

      assert.equal(
        abortObserved,
        true,
        "worker did not propagate cancellation to processor",
      );

      const { eq } =
        await import("drizzle-orm");

      const jobResult = await db
        .select()
        .from(generationJobs)
        .where(
          eq(
            generationJobs.id,
            fixture.jobId,
          ),
        )
        .limit(1);

      const storedJob =
        jobResult[0];

      assert.ok(storedJob);

      assert.equal(
        storedJob.status,
        "cancelled",
      );

      assert.equal(
        storedJob.output,
        null,
      );

      const reservationResult =
        await db
          .select()
          .from(creditReservations)
          .where(
            eq(
              creditReservations.id,
              fixture.reservationId,
            ),
          )
          .limit(1);

      const reservation =
        reservationResult[0];

      assert.ok(reservation);

      /*
       * Direct repository cancellation does not release money.
       * The API atomic cancellation path performs release.
       */
      assert.equal(
        reservation.status,
        "reserved",
      );

      const balanceResult =
        await db
          .select({
            availableCredits:
              creditBalances.availableCredits,
            reservedCredits:
              creditBalances.reservedCredits,
          })
          .from(creditBalances)
          .where(
            eq(
              creditBalances.id,
              fixture.balanceId,
            ),
          )
          .limit(1);

      const balance =
        balanceResult[0];

      assert.ok(balance);

      assert.equal(
        balance.availableCredits,
        90,
      );

      assert.equal(
        balance.reservedCredits,
        10,
      );

      const transactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              fixture.reservationId,
            ),
          );

      assert.equal(
        transactions.filter(
          (row) => row.type === "hold",
        ).length,
        1,
      );

      assert.equal(
        transactions.filter(
          (row) => row.type === "release",
        ).length,
        0,
      );

      assert.equal(
        transactions.filter(
          (row) => row.type === "consume",
        ).length,
        0,
      );

      const usage =
        await db
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.reservationId,
              fixture.reservationId,
            ),
          );

      assert.equal(
        usage.length,
        0,
      );

      console.log(
        "Live worker cancellation boundary assertions: GREEN",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);
/*
 * Deterministic integration-test database cleanup.
 * The test process owns the shared PostgreSQL pool.
 */
afterPoolCleanup(async () => {
  await testPoolCleanup.end();
});

