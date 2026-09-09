import { after as afterPoolCleanup } from "node:test";
import { pool as testPoolCleanup } from "@ak-vision-ai/database";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

import {
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
  generationJobs,
  generationOutputs,
  usageRecords,
  users,
} from "@ak-vision-ai/database";

import {
  reserveCredit,
} from "@ak-vision-ai/credits";

import {
  createGenerationJob,
} from "@ak-vision-ai/generation";

import type {
  GenerationProcessor,
} from "./processor.js";

import {
  GenerationWorker,
} from "./worker.js";

async function createTerminalFailureFixture(): Promise<{
  userId: string;
  balanceId: string;
  reservationId: string;
  jobId: string;
}> {
  const userResult =
    await db
      .insert(users)
      .values({
        email:
          `worker-terminal-${randomUUID()}@example.test`,
        displayName:
          "Worker Terminal Failure Test",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

  const user =
    userResult[0];

  assert.ok(user);

  const balanceResult =
    await db
      .insert(creditBalances)
      .values({
        userId:
          user.id,
        organizationId:
          null,
        availableCredits:
          100,
        reservedCredits:
          0,
        currency:
          "INR",
      })
      .returning({
        id: creditBalances.id,
      });

  const balance =
    balanceResult[0];

  assert.ok(balance);

  const reservation =
    await reserveCredit({
      userId:
        user.id,
      amount:
        10,
      idempotencyKey:
        `terminal-failure-reservation-${randomUUID()}`,
      referenceId:
        `terminal-failure-${randomUUID()}`,
    });

  assert.ok(reservation);

  const reservedBalanceResult =
    await db
      .select({
        availableCredits:
          creditBalances.availableCredits,
        reservedCredits:
          creditBalances.reservedCredits,
      })
      .from(
        creditBalances,
      )
      .where(
        (
          await import("drizzle-orm")
        ).eq(
          creditBalances.id,
          balance.id,
        ),
      )
      .limit(1);

  const reservedBalance =
    reservedBalanceResult[0];

  assert.ok(reservedBalance);

  assert.equal(
    reservedBalance.availableCredits,
    90,
  );

  assert.equal(
    reservedBalance.reservedCredits,
    10,
  );

  const job =
    await createGenerationJob({
      requestId:
        randomUUID(),
      userId:
        user.id,
      creditReservationId:
        reservation.id,
      type:
        "video",
      priority:
        "normal",
      providerId:
        "terminal-failure-provider",
      prompt:
        "Terminal failure integration test",
      input: {
        integration:
          "terminal-failure",
      },
      maxAttempts:
        3,
    });

  assert.ok(job);

  return {
    userId:
      user.id,
    balanceId:
      balance.id,
    reservationId:
      reservation.id,
    jobId:
      job.id,
  };
}

async function cleanupTerminalFailureFixture(
  fixture: {
    userId: string;
    reservationId: string;
  },
): Promise<void> {
  await db.transaction(
    async (tx) => {
      const {
        eq,
      } = await import("drizzle-orm");

      const jobs =
        await tx
          .select({
            id:
              generationJobs.id,
          })
          .from(
            generationJobs,
          )
          .where(
            eq(
              generationJobs.userId,
              fixture.userId,
            ),
          );

      for (const job of jobs) {
        await tx
          .delete(
            generationOutputs,
          )
          .where(
            eq(
              generationOutputs.jobId,
              job.id,
            ),
          );
      }

      await tx
        .delete(
          generationJobs,
        )
        .where(
          eq(
            generationJobs.userId,
            fixture.userId,
          ),
        );

      await tx
        .delete(
          usageRecords,
        )
        .where(
          eq(
            usageRecords.reservationId,
            fixture.reservationId,
          ),
        );

      await tx
        .delete(
          creditTransactions,
        )
        .where(
          eq(
            creditTransactions.reservationId,
            fixture.reservationId,
          ),
        );

      await tx
        .delete(
          creditReservations,
        )
        .where(
          eq(
            creditReservations.id,
            fixture.reservationId,
          ),
        );

      await tx
        .delete(
          creditBalances,
        )
        .where(
          eq(
            creditBalances.userId,
            fixture.userId,
          ),
        );

      await tx
        .delete(
          users,
        )
        .where(
          eq(
            users.id,
            fixture.userId,
          ),
        );
    },
  );
}

test(
  "real terminal generation failure releases reserved credits and records release ledger",
  async () => {
    const fixture =
      await createTerminalFailureFixture();

    try {
      const processor:
        GenerationProcessor = {
        async process() {
          const error =
            new Error(
              "Permanent provider failure",
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
              "worker-terminal-failure-e2e",
            leaseMs:
              5_000,
            heartbeatMs:
              1_000,
          },
        );

      const processed =
        await worker.runOnce();

      assert.equal(
        processed,
        true,
      );

      const jobResult =
        await db
          .select()
          .from(
            generationJobs,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
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
        "failed",
      );

      assert.equal(
        storedJob.errorCode,
        "PERMANENT_PROVIDER_ERROR",
      );

      const reservationResult =
        await db
          .select()
          .from(
            creditReservations,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
              creditReservations.id,
              fixture.reservationId,
            ),
          )
          .limit(1);

      const reservation =
        reservationResult[0];

      assert.ok(reservation);

      assert.equal(
        reservation.status,
        "released",
      );

      const balanceResult =
        await db
          .select({
            availableCredits:
              creditBalances.availableCredits,
            reservedCredits:
              creditBalances.reservedCredits,
          })
          .from(
            creditBalances,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
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
        100,
      );

      assert.equal(
        balance.reservedCredits,
        0,
      );

      const transactions =
        await db
          .select()
          .from(
            creditTransactions,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
              creditTransactions.reservationId,
              fixture.reservationId,
            ),
          );

      assert.equal(
        transactions.length,
        2,
      );

      const holdTransactions =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "hold",
        );

      const releaseTransactions =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "release",
        );

      assert.equal(
        holdTransactions.length,
        1,
      );

      assert.equal(
        releaseTransactions.length,
        1,
      );

      const hold =
        holdTransactions[0];

      const release =
        releaseTransactions[0];

      assert.ok(hold);
      assert.ok(release);

      assert.equal(
        hold.amount,
        10,
      );

      assert.equal(
        hold.availableBalanceAfter,
        90,
      );

      assert.equal(
        hold.reservedBalanceAfter,
        10,
      );

      assert.equal(
        release.amount,
        10,
      );

      assert.equal(
        release.availableBalanceAfter,
        100,
      );

      assert.equal(
        release.reservedBalanceAfter,
        0,
      );

      const usageResult =
        await db
          .select()
          .from(
            usageRecords,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
              usageRecords.requestId,
              storedJob.requestId,
            ),
          );

      assert.equal(
        usageResult.length,
        0,
      );

      console.log(
        "Terminal failure release E2E: GREEN",
      );
    } finally {
      await cleanupTerminalFailureFixture(
        fixture,
      );
    }
  },
);

test(
  "retryable failure at max attempts becomes terminal and releases reserved credits",
  async () => {
    const fixture =
        await createTerminalFailureFixture();

      const { eq } =
        await import("drizzle-orm");

      // Force this worker execution to be the final allowed attempt.
      await db
        .update(generationJobs)
        .set({
          attemptCount: 2,
        })
        .where(
          eq(
            generationJobs.id,
            fixture.jobId,
          ),
        );

    try {
      const processor:
        GenerationProcessor = {
        async process() {
          const error =
            new Error(
              "Permanent provider failure",
            ) as Error & {
              code?: string;
              retryable?: boolean;
            };

          error.code =
            "PERMANENT_PROVIDER_ERROR";

          error.retryable = true;

          throw error;
        },
      };

      const worker =
        new GenerationWorker(
          processor,
          {
            workerId:
              "worker-terminal-failure-max-attempts-e2e",
            leaseMs:
              5_000,
            heartbeatMs:
              1_000,
          },
        );

      const processed =
        await worker.runOnce();

      assert.equal(
        processed,
        true,
      );

      const jobResult =
        await db
          .select()
          .from(
            generationJobs,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
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
        "failed",
      );

      assert.equal(
        storedJob.errorCode,
        "PERMANENT_PROVIDER_ERROR",
      );

      const reservationResult =
        await db
          .select()
          .from(
            creditReservations,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
              creditReservations.id,
              fixture.reservationId,
            ),
          )
          .limit(1);

      const reservation =
        reservationResult[0];

      assert.ok(reservation);

      assert.equal(
        reservation.status,
        "released",
      );

      const balanceResult =
        await db
          .select({
            availableCredits:
              creditBalances.availableCredits,
            reservedCredits:
              creditBalances.reservedCredits,
          })
          .from(
            creditBalances,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
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
        100,
      );

      assert.equal(
        balance.reservedCredits,
        0,
      );

      const transactions =
        await db
          .select()
          .from(
            creditTransactions,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
              creditTransactions.reservationId,
              fixture.reservationId,
            ),
          );

      assert.equal(
        transactions.length,
        2,
      );

      const holdTransactions =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "hold",
        );

      const releaseTransactions =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "release",
        );

      assert.equal(
        holdTransactions.length,
        1,
      );

      assert.equal(
        releaseTransactions.length,
        1,
      );

      const hold =
        holdTransactions[0];

      const release =
        releaseTransactions[0];

      assert.ok(hold);
      assert.ok(release);

      assert.equal(
        hold.amount,
        10,
      );

      assert.equal(
        hold.availableBalanceAfter,
        90,
      );

      assert.equal(
        hold.reservedBalanceAfter,
        10,
      );

      assert.equal(
        release.amount,
        10,
      );

      assert.equal(
        release.availableBalanceAfter,
        100,
      );

      assert.equal(
        release.reservedBalanceAfter,
        0,
      );

      const usageResult =
        await db
          .select()
          .from(
            usageRecords,
          )
          .where(
            (
              await import("drizzle-orm")
            ).eq(
              usageRecords.requestId,
              storedJob.requestId,
            ),
          );

      assert.equal(
        usageResult.length,
        0,
      );

      console.log(
        "Max-attempt retryable failure: GREEN",
      );
    } finally {
      await cleanupTerminalFailureFixture(
        fixture,
      );
    }
  },
);

test(
  "real database failure during terminal transition preserves recoverable job and reserved credits",
  async () => {
    const fixture =
      await createTerminalFailureFixture();

    const { eq, sql } =
      await import("drizzle-orm");

    const suffix =
      randomUUID().replace(/-/g, "_");

    const functionName =
      `ak_test_fail_generation_${suffix}`;

    const triggerName =
      `ak_test_fail_generation_${suffix}_trigger`;

    try {
      await db.execute(
        sql.raw(`
          CREATE FUNCTION ${functionName}()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $failure$
          BEGIN
            IF NEW.id = '${fixture.jobId}'::uuid
               AND OLD.status = 'processing'
               AND NEW.status <> 'processing'
            THEN
              RAISE EXCEPTION
                'intentional real database failure for worker E2E'
                USING ERRCODE = 'XX000';
            END IF;

            RETURN NEW;
          END;
          $failure$;
        `),
      );

      await db.execute(
        sql.raw(`
          CREATE TRIGGER ${triggerName}
          BEFORE UPDATE ON generation_jobs
          FOR EACH ROW
          EXECUTE FUNCTION ${functionName}();
        `),
      );

      const processor:
        GenerationProcessor = {
        async process() {
          const error =
            new Error(
              "Permanent provider failure before DB fault",
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
              "worker-real-db-failure-e2e",
            leaseMs:
              5_000,
            heartbeatMs:
              1_000,
          },
        );

      const processed =
        await worker.runOnce();

      assert.equal(
        processed,
        true,
      );

      const jobResult =
        await db
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
        "processing",
      );

      assert.equal(
        storedJob.lockedBy,
        "worker-real-db-failure-e2e",
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

      const transactionResult =
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
        transactionResult.filter(
          (transaction) =>
            transaction.type === "hold",
        ).length,
        1,
      );

      assert.equal(
        transactionResult.filter(
          (transaction) =>
            transaction.type === "release",
        ).length,
        0,
      );

      assert.equal(
        transactionResult.filter(
          (transaction) =>
            transaction.type === "consume",
        ).length,
        0,
      );

      const usageResult =
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
        usageResult.length,
        0,
      );

      console.log(
        "Real PostgreSQL failure E2E assertions: GREEN",
      );
    } finally {
      try {
        await db.execute(
          sql.raw(`
            DROP TRIGGER IF EXISTS
              ${triggerName}
            ON generation_jobs;
          `),
        );
      } finally {
        await db.execute(
          sql.raw(`
            DROP FUNCTION IF EXISTS
              ${functionName}();
          `),
        );
      }

      await cleanupTerminalFailureFixture(
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


