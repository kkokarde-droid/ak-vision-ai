import { after as afterPoolCleanup } from "node:test";
import { pool as testPoolCleanup } from "@ak-vision-ai/database";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  artifactVersions,
  artifacts,
  db,
  users,
  creditBalances,
  creditReservations,
  creditTransactions,
  usageRecords,
  generationJobs,
  generationOutputs,
} from "@ak-vision-ai/database";

import {
  AIExecutor,
  AIRouter,
  ProviderRegistry,
} from "@ak-vision-ai/ai-core";

import {
  reserveCredit,
  settleCreditReservation,
} from "@ak-vision-ai/credits";
import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "@ak-vision-ai/ai-core";

import type {
  AIResponse,
  AITaskType,
  ProviderCapability,
} from "@ak-vision-ai/types";

import {
  AIExecutorGenerationProcessor,
} from "./processor.js";

import {
  GenerationWorker,
} from "./worker.js";

import {
  claimNextGenerationJob,
} from "@ak-vision-ai/generation";

const execFileAsync = promisify(execFile);

let integrationVideoUrl = "";

async function createIntegrationMediaServer() {
  const workspace = await mkdtemp(
    join(tmpdir(), "ak-vision-worker-media-"),
  );

  const fixturePath = join(workspace, "fixture.mp4");

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x180:r=24",
      "-t",
      "1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      fixturePath,
    ],
    { windowsHide: true },
  );

  const fixture = await readFile(fixturePath);

  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("Content-Type", "video/mp4");
    response.setHeader("Content-Length", fixture.length);
    response.end(fixture);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error(
      "Integration media server did not expose a TCP address.",
    );
  }

  integrationVideoUrl =
    `http://127.0.0.1:${address.port}/output.mp4`;

  return { server, workspace };
}

async function closeIntegrationMediaServer(
  server: ReturnType<typeof createServer>,
  workspace: string,
) {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await rm(workspace, {
    recursive: true,
    force: true,
  });

  integrationVideoUrl = "";
}

let integrationMediaServer: ReturnType<typeof createServer> | undefined;
let integrationMediaWorkspace = "";

before(async () => {
  const fixture = await createIntegrationMediaServer();
  integrationMediaServer = fixture.server;
  integrationMediaWorkspace = fixture.workspace;
});

after(async () => {
  if (integrationMediaServer !== undefined) {
    await closeIntegrationMediaServer(
      integrationMediaServer,
      integrationMediaWorkspace,
    );
    integrationMediaServer = undefined;
    integrationMediaWorkspace = "";
  }
});

class IntegrationVideoProvider
  implements AIProvider
{
  readonly providerId =
    "integration-video";

  readonly providerName =
    "Integration Video Provider";

  readonly status =
    "active" as const;

  readonly capabilities =
    [
      "video-generation",
      "image-to-video",
      "text-to-video",
    ] as const;

  supports(
    taskType: AITaskType,
  ): boolean {
    return (
      taskType ===
      "video-generation"
    );
  }

  supportsCapability(
    capability: ProviderCapability,
  ): boolean {
    return (
      this.capabilities as readonly string[]
    ).includes(capability);
  }

  async generate<T = unknown>(
    _input: AIProviderRequest,
    context: AIProviderContext,
  ): Promise<AIResponse<T>> {
    const providerRequestId =
      `integration-provider-${randomUUID()}`;

    if (context.onSubmitted) {
      await context.onSubmitted(
        providerRequestId,
      );
    }

    return {
      requestId:
        context.requestId,

      success: true,

      result: {
        provider:
          this.providerId,

        providerRequestId,

        output: {
          type: "video",
          url:
            integrationVideoUrl,
          mimeType: "video/mp4",
        },
      } as T,

      createdAt:
        new Date().toISOString(),
    };
  }
}

async function createFixture() {
  const userResult =
    await db
      .insert(users)
      .values({
        email:
          `worker-integration-${randomUUID()}@example.test`,
        displayName:
          "Worker Integration Test",
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
        id:
          creditBalances.id,
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
        `worker-integration-reservation-${randomUUID()}`,
      referenceId:
        `worker-integration-${randomUUID()}`,
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
      .from(creditBalances)
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
return {
    userId:
      user.id,
    balanceId:
      balance.id,
    reservationId:
      reservation.id,
  };
}

async function cleanupFixture(
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

      const userArtifacts =
      await tx
        .select({
          id:
            artifacts.id,
        })
        .from(
          artifacts,
        )
        .where(
          eq(
            artifacts.ownerUserId,
            fixture.userId,
          ),
        );

      for (const artifact of userArtifacts) {
        await tx
          .delete(
            artifactVersions,
          )
          .where(
            eq(
              artifactVersions.artifactId,
              artifact.id,
            ),
          );
      }

      await tx
        .delete(
          artifacts,
        )
        .where(
          eq(
            artifacts.ownerUserId,
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
        .delete(users)
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
  "real worker execution chain persists provider request, output, and completes job",
  async () => {
    const fixture =
      await createFixture();

    try {
      const requestId =
        randomUUID();

      const jobResult =
        await db
          .insert(generationJobs)
          .values({
            requestId,
            userId:
              fixture.userId,
            creditReservationId:
              fixture.reservationId,
            type:
              "video",
            status:
              "queued",
            priority:
"high",
            createdAt:
              new Date(0),
            prompt:
              "Integration test video",
            input: {
              mode:
                "quality",
            },
            maxAttempts:
              3,
          })
          .returning();

      const job =
        jobResult[0];

      assert.ok(job);

      const registry =
        new ProviderRegistry();

      registry.register(
        new IntegrationVideoProvider(),
      );

      const router =
        new AIRouter(
          registry,
          {
            preferredProviderId:
              "integration-video",
          },
        );

      const executor =
        new AIExecutor(
          router,
          {
            timeoutMs:
              30_000,
            retryCount:
              0,
            fallbackEnabled:
              false,
          },
        );

      const processor =
        new AIExecutorGenerationProcessor(
          executor,
          "worker-integration",
        );

      const worker =
        new GenerationWorker(
          processor,
          {
            workerId:
              "worker-integration",
            leaseMs:
              120_000,
            heartbeatMs:
              10_000,
          },
        );

      const processed =
        await worker.runOnce();

      assert.equal(
        processed,
        true,
      );

      const storedJobResult =
        await db
          .select()
          .from(generationJobs)
          .where(
            (
              await import("drizzle-orm")
            ).eq(
              generationJobs.id,
              job.id,
            ),
          )
          .limit(1);

      const storedJob =
        storedJobResult[0];

      assert.ok(storedJob);

      assert.equal(
        storedJob.status,
        "completed",
      );

      assert.equal(
        storedJob.progress,
        100,
      );

      assert.ok(
        storedJob.providerRequestId,
      );

      assert.equal(
        storedJob.providerId,
        "integration-video",
      );

      const outputResult =
        await db
          .select()
          .from(generationOutputs)
          .where(
            (
              await import("drizzle-orm")
            ).eq(
              generationOutputs.jobId,
              job.id,
            ),
          );

      assert.equal(
        outputResult.length,
        1,
      );

      assert.equal(
        outputResult[0]?.type,
        "video",
      );



    const persistedOutput =
      outputResult[0];

    assert.ok(
      persistedOutput,
    );

    const artifactId =
      persistedOutput.artifactId;

    assert.ok(
      artifactId,
    );

    const expectedStorageKey =
      "generations/" +
      job.id +
      "/final.mp4";

    assert.equal(
      persistedOutput.url,
      "storage://local/" +
      expectedStorageKey,
    );

    const { eq } =
      await import("drizzle-orm");

    const artifactResult =
      await db
        .select()
        .from(artifacts)
        .where(
          eq(
            artifacts.id,
            artifactId,
          ),
        )
        .limit(1);

    const persistedArtifact =
      artifactResult[0];

    assert.ok(
      persistedArtifact,
    );

    assert.equal(
      persistedArtifact.storageKey,
      expectedStorageKey,
    );

    assert.equal(
      persistedArtifact.storageUrl,
      persistedOutput.url,
    );

    assert.equal(
      persistedArtifact.ownerUserId,
      fixture.userId,
    );

    assert.equal(
      persistedArtifact.mimeType,
      "video/mp4",
    );

    assert.ok(
      persistedArtifact.sizeBytes !== null,
    );

    assert.ok(
      persistedArtifact.sizeBytes > 0,
    );

    const storageRoot =
      process.env.MEDIA_STORAGE_ROOT?.trim() ||
      "worker-storage";

    const physicalArtifactPath =
      resolve(
        process.cwd(),
        storageRoot,
        expectedStorageKey,
      );

    const physicalArtifact =
      await stat(
        physicalArtifactPath,
      );

    assert.equal(
      physicalArtifact.isFile(),
      true,
    );

    assert.ok(
      physicalArtifact.size > 0,
    );

    assert.equal(
      physicalArtifact.size,
      persistedArtifact.sizeBytes,
    );

    console.log(
      "P3-61D physical storage assertion: GREEN (" +
      physicalArtifactPath +
      ")",
    );

    console.log(
      "=== FINANCIAL SETTLEMENT ASSERTIONS ===",
    );

    const reservationResult =
      await db
        .select({
          status:
            creditReservations.status,
          amount:
            creditReservations.amount,
          creditBalanceId:
            creditReservations.creditBalanceId,
        })
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

    const settledReservation =
      reservationResult[0];

    assert.ok(
      settledReservation,
    );

    assert.equal(
      settledReservation.status,
      "consumed",
    );

    assert.equal(
      settledReservation.amount,
      10,
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
            settledReservation.creditBalanceId,
          ),
        )
        .limit(1);

    const settledBalance =
      balanceResult[0];

    assert.ok(
      settledBalance,
    );

    assert.equal(
      settledBalance.availableCredits,
      90,
    );

    assert.equal(
      settledBalance.reservedCredits,
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
            job.requestId,
          ),
        );

    assert.equal(
      usageResult.length,
      1,
    );

    const usage =
      usageResult[0];

    assert.ok(
      usage,
    );

    assert.equal(
      usage.reservationId,
      fixture.reservationId,
    );

    assert.equal(
      usage.creditsUsed,
      10,
    );

    assert.equal(
      usage.providerId,
      storedJob.providerId,
    );

    assert.equal(
      usage.currency,
      "INR",
    );

    const transactionResult =
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

    /*
     * reserveCredit() creates the reserve event.
     * Successful settlement creates the consume event.
     */
    assert.equal(
      transactionResult.length,
      2,
    );

    const reserveTransactions =
      transactionResult.filter(
        (transaction) =>
          transaction.type === "hold",
      );

    const consumeTransactions =
      transactionResult.filter(
        (transaction) =>
          transaction.type === "consume",
      );

    assert.equal(
      reserveTransactions.length,
      1,
    );

    assert.equal(
      consumeTransactions.length,
      1,
    );

    const reserveTransaction =
      reserveTransactions[0];

    assert.ok(
      reserveTransaction,
    );

    assert.equal(
      reserveTransaction.amount,
      10,
    );

    const settlementTransaction =
      consumeTransactions[0];

    assert.ok(
      settlementTransaction,
    );

    assert.equal(
      settlementTransaction.type,
      "consume",
    );

    assert.equal(
      settlementTransaction.amount,
      10,
    );

    assert.equal(
      settlementTransaction.availableBalanceAfter,
      90,
    );

    assert.equal(
      settlementTransaction.reservedBalanceAfter,
      0,
    );

    assert.equal(
      outputResult.length,
      1,
    );

    console.log("Financial settlement assertions: GREEN");

    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "real PostgreSQL settlement failure rolls back balance reservation ledger and usage atomically",
  async () => {
    const fixture =
      await createFixture();

    const { eq, sql } =
      await import("drizzle-orm");

    const suffix =
      randomUUID().replace(/-/g, "_");

    const functionName =
      `ak_test_fail_consume_${suffix}`;

    const triggerName =
      `ak_test_fail_consume_${suffix}_trigger`;

    const settlementInput = {
      reservationId:
        fixture.reservationId,
      referenceId:
        `settlement-rollback-${randomUUID()}`,
      usage: {
        requestId:
          randomUUID(),
        providerId:
          "settlement-rollback-provider",
        creditsUsed:
          10,
        currency:
          "INR",
      },
    };

    try {
      await db.execute(
        sql.raw(`
          CREATE FUNCTION ${functionName}()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $failure$
          BEGIN
            IF NEW.reservation_id = '${fixture.reservationId}'::uuid
               AND NEW.type = 'consume'
            THEN
              RAISE EXCEPTION
                'intentional real database settlement failure for E2E'
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
          BEFORE INSERT ON credit_transactions
          FOR EACH ROW
          EXECUTE FUNCTION ${functionName}();
        `),
      );

      await assert.rejects(
        () =>
          settleCreditReservation(
            settlementInput,
            {
              userId:
                fixture.userId,
            },
          ),
      );

      /*
       * The transaction must have rolled back every mutation
       * performed before the failing consume-ledger INSERT.
       */
      const balanceAfterFailure =
        (
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
            .limit(1)
        )[0];

      assert.ok(balanceAfterFailure);

      assert.equal(
        balanceAfterFailure.availableCredits,
        90,
      );

      assert.equal(
        balanceAfterFailure.reservedCredits,
        10,
      );

      const reservationAfterFailure =
        (
          await db
            .select()
            .from(creditReservations)
            .where(
              eq(
                creditReservations.id,
                fixture.reservationId,
              ),
            )
            .limit(1)
        )[0];

      assert.ok(reservationAfterFailure);

      assert.equal(
        reservationAfterFailure.status,
        "reserved",
      );

      const transactionsAfterFailure =
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
        transactionsAfterFailure.filter(
          (transaction) =>
            transaction.type === "hold",
        ).length,
        1,
      );

      assert.equal(
        transactionsAfterFailure.filter(
          (transaction) =>
            transaction.type === "consume",
        ).length,
        0,
      );

      const usageAfterFailure =
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
        usageAfterFailure.length,
        0,
      );

      /*
       * Remove the DB fault and retry the exact settlement.
       * This proves the rolled-back transaction did not poison
       * the reservation or idempotency state.
       */
      await db.execute(
        sql.raw(`
          DROP TRIGGER IF EXISTS
            ${triggerName}
          ON credit_transactions;
        `),
      );

      await db.execute(
        sql.raw(`
          DROP FUNCTION IF EXISTS
            ${functionName}();
        `),
      );

      const settled =
        await settleCreditReservation(
          settlementInput,
          {
            userId:
              fixture.userId,
          },
        );

      assert.ok(settled);

      const finalBalance =
        (
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
            .limit(1)
        )[0];

      assert.ok(finalBalance);

      /*
       * The entire 10-credit reservation is consumed.
       * Therefore available credits remain 90 while
       * reserved credits return to 0.
       */
      assert.equal(
        finalBalance.availableCredits,
        90,
      );

      assert.equal(
        finalBalance.reservedCredits,
        0,
      );

      const finalReservation =
        (
          await db
            .select()
            .from(creditReservations)
            .where(
              eq(
                creditReservations.id,
                fixture.reservationId,
              ),
            )
            .limit(1)
        )[0];

      assert.ok(finalReservation);

      assert.equal(
        finalReservation.status,
        "consumed",
      );

      const finalTransactions =
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
        finalTransactions.filter(
          (transaction) =>
            transaction.type === "hold",
        ).length,
        1,
      );

      assert.equal(
        finalTransactions.filter(
          (transaction) =>
            transaction.type === "consume",
        ).length,
        1,
      );

      const finalUsage =
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
        finalUsage.length,
        1,
      );

      console.log(
        "Settlement rollback + recovery assertions: GREEN",
      );
    } finally {
      /*
       * Idempotent cleanup in case an assertion or DB operation
       * fails before the normal trigger removal point.
       */
      try {
        await db.execute(
          sql.raw(`
            DROP TRIGGER IF EXISTS
              ${triggerName}
            ON credit_transactions;
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

