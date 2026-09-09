import { eq } from "drizzle-orm";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  creditBalances,
  creditReservations,
  db,
  generationJobs,
  generationOutputs,
  users,
} from "@ak-vision-ai/database";

import {
  GenerationRepositoryError,
  cancelGenerationJob,
  claimNextGenerationJob,
  completeGenerationJob,
  createGenerationJob,
  createGenerationOutput,
  failGenerationJob,
  getGenerationJob,
  heartbeatGenerationJob,
  listGenerationOutputs,
  setGenerationProviderRequest,
  updateGenerationProgress,
} from "@ak-vision-ai/generation";

type Fixture = {
  userId: string;
  reservationId: string;
};

async function createFixture(): Promise<Fixture> {
  const email =
    `generation-test-${randomUUID()}@example.test`;

  const userResult = await db
    .insert(users)
    .values({
      email,
      displayName: "Generation Test User",
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

  const reservationResult = await db
    .insert(creditReservations)
    .values({
      creditBalanceId: balance.id,
      userId: user.id,
      organizationId: null,
      amount: 10,
      status: "reserved",
      idempotencyKey:
        `generation-reservation-${randomUUID()}`,
    })
    .returning({
      id: creditReservations.id,
    });

  const reservation =
    reservationResult[0];

  assert.ok(reservation);

  return {
    userId: user.id,
    reservationId: reservation.id,
  };
}

async function cleanupFixture(
  fixture: Fixture,
): Promise<void> {
  const { eq } =
    await import("drizzle-orm");

  await db.transaction(async (tx) => {
    const userJobs =
      await tx
        .select({
          id: generationJobs.id,
        })
        .from(generationJobs)
        .where(
          eq(
            generationJobs.userId,
            fixture.userId,
          ),
        );

    for (const job of userJobs) {
      await tx
        .delete(generationOutputs)
        .where(
          eq(
            generationOutputs.jobId,
            job.id,
          ),
        );
    }

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
function jobInput(
  fixture: Fixture,
  overrides: Partial<Parameters<
    typeof createGenerationJob
  >[0]> = {},
) {
  return {
    requestId:
      randomUUID(),
    userId:
      fixture.userId,
    creditReservationId:
      fixture.reservationId,
    type: "video" as const,
    priority: "normal" as const,
    prompt:
      "Generate a production test video",
    ...overrides,
  };
}

test(
  "generation repository creates a job successfully",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      assert.equal(
        job.userId,
        fixture.userId,
      );

      assert.equal(
        job.creditReservationId,
        fixture.reservationId,
      );

      assert.equal(
        job.status,
        "queued",
      );

      assert.equal(
        job.progress,
        0,
      );

      assert.equal(
        job.attemptCount,
        0,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "same requestId is idempotent",
  async () => {
    const fixture =
      await createFixture();

    try {
      const input =
        jobInput(fixture);

      const first =
        await createGenerationJob(
          input,
        );

      const second =
        await createGenerationJob(
          input,
        );

      assert.equal(
        first.id,
        second.id,
      );

      assert.equal(
        first.requestId,
        second.requestId,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "same requestId with another owner is rejected",
  async () => {
    const fixtureA =
      await createFixture();

    const fixtureB =
      await createFixture();

    try {
      const requestId =
        randomUUID();

      await createGenerationJob(
        jobInput(
          fixtureA,
          {
            requestId,
          },
        ),
      );

      await assert.rejects(
        () =>
          createGenerationJob(
            jobInput(
              fixtureB,
              {
                requestId,
              },
            ),
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "IDEMPOTENCY_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixtureA,
      );

      await cleanupFixture(
        fixtureB,
      );
    }
  },
);

test(
  "concurrent same requestId creates exactly one job",
  async () => {
    const fixture =
      await createFixture();

    try {
      const requestId =
        randomUUID();

      const results =
        await Promise.all(
          Array.from(
            { length: 10 },
            () =>
              createGenerationJob(
                jobInput(
                  fixture,
                  {
                    requestId,
                  },
                ),
              ),
          ),
        );

      const ids =
        new Set(
          results.map(
            (job) => job.id,
          ),
        );

      assert.equal(
        ids.size,
        1,
      );

      assert.equal(
        results.length,
        10,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "concurrent workers cannot claim the same queued job",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      const claims =
        await Promise.all([
          claimNextGenerationJob(
            "worker-a",
            60_000,
          ),
          claimNextGenerationJob(
            "worker-b",
            60_000,
          ),
        ]);

      const claimed =
        claims.filter(
          Boolean,
        );

      assert.equal(
        claimed.length,
        1,
      );

      assert.equal(
        claimed[0]?.id,
        job.id,
      );

      assert.equal(
        claimed[0]?.status,
        "processing",
      );

      assert.equal(
        claimed[0]?.attemptCount,
        1,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "expired processing lease can be reclaimed",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      const past =
        new Date(
          Date.now() - 60_000,
        );

      await db
        .update(generationJobs)
        .set({
          status: "processing",
          attemptCount: 1,
          lockedBy: "dead-worker",
          lockedAt: past,
          leaseExpiresAt: past,
          startedAt: past,
          updatedAt: past,
        })
        .where(
          (await import("drizzle-orm")).eq(
            generationJobs.id,
            job.id,
          ),
        );

      const reclaimed =
        await claimNextGenerationJob(
          "replacement-worker",
          60_000,
        );

      assert.ok(reclaimed);

      assert.equal(
        reclaimed.id,
        job.id,
      );

      assert.equal(
        reclaimed.lockedBy,
        "replacement-worker",
      );

      assert.equal(
        reclaimed.attemptCount,
        2,
      );

      assert.equal(
        reclaimed.status,
        "processing",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "expired final-attempt lease becomes failed instead of being requeued",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(
            fixture,
            {
              maxAttempts: 1,
            },
          ),
        );

      const past =
        new Date(
          Date.now() - 60_000,
        );

      await db
        .update(generationJobs)
        .set({
          status: "processing",
          attemptCount: 1,
          lockedBy: "dead-worker",
          lockedAt: past,
          leaseExpiresAt: past,
          startedAt: past,
          updatedAt: past,
        })
        .where(
          (await import("drizzle-orm")).eq(
            generationJobs.id,
            job.id,
          ),
        );

      const next =
        await claimNextGenerationJob(
          "replacement-worker",
          60_000,
        );

      assert.equal(
        next,
        null,
      );

      const recovered =
        await getGenerationJob(
          job.id,
          {
            userId:
              fixture.userId,
          },
        );

      assert.ok(recovered);

      assert.equal(
        recovered.status,
        "failed",
      );

      assert.equal(
        recovered.errorCode,
        "MAX_ATTEMPTS_EXHAUSTED",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "wrong worker cannot heartbeat another worker's lease",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      const claimed =
        await claimNextGenerationJob(
          "worker-a",
          60_000,
        );

      assert.ok(claimed);
      assert.equal(
        claimed.id,
        job.id,
      );

      await assert.rejects(
        () =>
          heartbeatGenerationJob(
            job.id,
            "worker-b",
            60_000,
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "LEASE_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "correct worker can heartbeat its lease",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      const claimed =
        await claimNextGenerationJob(
          "worker-a",
          60_000,
        );

      assert.ok(claimed);

      const before =
        claimed.leaseExpiresAt;

      const renewed =
        await heartbeatGenerationJob(
          job.id,
          "worker-a",
          120_000,
        );

      assert.ok(
        renewed.leaseExpiresAt,
      );

      assert.ok(
        renewed.leaseExpiresAt!.getTime() >
          before!.getTime(),
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "progress accepts 0..99 but rejects 100",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const progress =
        await updateGenerationProgress(
          job.id,
          "worker-a",
          55,
        );

      assert.equal(
        progress.progress,
        55,
      );

      await assert.rejects(
        () =>
          updateGenerationProgress(
            job.id,
            "worker-a",
            100,
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "INVALID_INPUT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "wrong worker cannot complete a generation job",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      await assert.rejects(
        () =>
          completeGenerationJob(
            job.id,
            "worker-b",
            {
              url:
                "https://example.test/video.mp4",
            },
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "LEASE_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "correct worker can complete a generation job",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const completed =
        await completeGenerationJob(
          job.id,
          "worker-a",
          {
            artifact:
              "generation-output",
          },
        );

      assert.equal(
        completed.status,
        "completed",
      );

      assert.equal(
        completed.progress,
        100,
      );

      assert.equal(
        completed.lockedBy,
        null,
      );

      assert.equal(
        completed.leaseExpiresAt,
        null,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "retryable failure requeues the job",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(
            fixture,
            {
              maxAttempts: 3,
            },
          ),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const failed =
        await failGenerationJob(
          job.id,
          "worker-a",
          {
            errorCode:
              "TEMPORARY_PROVIDER_ERROR",
            errorMessage:
              "Temporary provider failure",
            retryDelayMs: 0,
          },
        );

      assert.equal(
        failed.status,
        "queued",
      );

      assert.equal(
        failed.attemptCount,
        1,
      );

      assert.equal(
        failed.lockedBy,
        null,
      );

      assert.ok(
        failed.nextAttemptAt,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "final failure permanently fails the job",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(
            fixture,
            {
              maxAttempts: 1,
            },
          ),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const failed =
        await failGenerationJob(
          job.id,
          "worker-a",
          {
            errorCode:
              "PERMANENT_PROVIDER_ERROR",
            errorMessage:
              "Permanent provider failure",
            retryDelayMs: 0,
          },
        );

      assert.equal(
        failed.status,
        "failed",
      );

      assert.equal(
        failed.errorCode,
        "PERMANENT_PROVIDER_ERROR",
      );

      assert.ok(
        failed.completedAt,
      );

      assert.equal(
        failed.lockedBy,
        null,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "owner can cancel queued job and worker can no longer complete it",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      const cancelled =
        await cancelGenerationJob(
          job.id,
          {
            userId:
              fixture.userId,
          },
        );

      assert.equal(
        cancelled.status,
        "cancelled",
      );

      await assert.rejects(
        () =>
          completeGenerationJob(
            job.id,
            "worker-a",
            {
              done: true,
            },
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "LEASE_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "generation output persists and lists deterministically",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      const first =
        await createGenerationOutput({
          jobId: job.id,
          idempotencyKey: "generation-output-1",
          type: "video",
          url:
            "https://example.test/video-1.mp4",
          mimeType:
            "video/mp4",
          sizeBytes:
            1024,
          metadata: {
            order: 1,
          },
        });

      const second =
        await createGenerationOutput({
          jobId: job.id,
          idempotencyKey: "generation-output-2",
          type: "video",
          url:
            "https://example.test/video-2.mp4",
          mimeType:
            "video/mp4",
          sizeBytes:
            2048,
          metadata: {
            order: 2,
          },
        });

      const outputs =
        await listGenerationOutputs(
          job.id,
        );

      assert.equal(
        outputs.length,
        2,
      );

      assert.equal(
        outputs[0]?.id,
        first.id,
      );

      assert.equal(
        outputs[1]?.id,
        second.id,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "correct worker can persist provider id and provider request id",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const updated =
        await setGenerationProviderRequest(
          job.id,
          "worker-a",
          "higgsfield",
          "hf-request-001",
        );

      assert.equal(
        updated.providerId,
        "higgsfield",
      );

      assert.equal(
        updated.providerRequestId,
        "hf-request-001",
      );

      const stored =
        await getGenerationJob(
          job.id,
          {
            userId:
              fixture.userId,
          },
        );

      assert.equal(
        stored?.providerId,
        "higgsfield",
      );

      assert.equal(
        stored?.providerRequestId,
        "hf-request-001",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "same provider and request id assignment is idempotent",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      await setGenerationProviderRequest(
        job.id,
        "worker-a",
        "higgsfield",
        "hf-request-002",
      );

      const second =
        await setGenerationProviderRequest(
          job.id,
          "worker-a",
          "higgsfield",
          "hf-request-002",
        );

      assert.equal(
        second.providerId,
        "higgsfield",
      );

      assert.equal(
        second.providerRequestId,
        "hf-request-002",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "different provider request id cannot replace an existing provider request",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      await setGenerationProviderRequest(
        job.id,
        "worker-a",
        "higgsfield",
        "hf-request-003",
      );

      await assert.rejects(
        () =>
          setGenerationProviderRequest(
            job.id,
            "worker-a",
            "higgsfield",
            "hf-request-004",
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "INVALID_STATE",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "different provider cannot replace an existing provider request",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      await setGenerationProviderRequest(
        job.id,
        "worker-a",
        "higgsfield",
        "hf-request-005",
      );

      await assert.rejects(
        () =>
          setGenerationProviderRequest(
            job.id,
            "worker-a",
            "other-provider",
            "hf-request-005",
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "INVALID_STATE",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "wrong worker cannot persist provider request",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      await assert.rejects(
        () =>
          setGenerationProviderRequest(
            job.id,
            "worker-b",
            "higgsfield",
            "hf-request-006",
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "LEASE_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "expired worker cannot persist provider request",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const { eq } =
        await import("drizzle-orm");

      await db
        .update(generationJobs)
        .set({
          leaseExpiresAt:
            new Date(
              Date.now() - 1_000,
            ),
        })
        .where(
          eq(
            generationJobs.id,
            job.id,
          ),
        );

      await assert.rejects(
        () =>
          setGenerationProviderRequest(
            job.id,
            "worker-a",
            "higgsfield",
            "hf-request-007",
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "LEASE_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "expired worker cannot update generation progress",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const { eq } =
        await import("drizzle-orm");

      await db
        .update(generationJobs)
        .set({
          leaseExpiresAt:
            new Date(
              Date.now() - 1_000,
            ),
        })
        .where(
          eq(
            generationJobs.id,
            job.id,
          ),
        );

      await assert.rejects(
        () =>
          updateGenerationProgress(
            job.id,
            "worker-a",
            55,
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "LEASE_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "expired worker cannot complete generation job",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const { eq } =
        await import("drizzle-orm");

      await db
        .update(generationJobs)
        .set({
          leaseExpiresAt:
            new Date(
              Date.now() - 1_000,
            ),
        })
        .where(
          eq(
            generationJobs.id,
            job.id,
          ),
        );

      await assert.rejects(
        () =>
          completeGenerationJob(
            job.id,
            "worker-a",
            {
              providerRequestId:
                "hf-request-008",
            },
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "LEASE_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "expired worker cannot persist generation failure",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const { eq } =
        await import("drizzle-orm");

      await db
        .update(generationJobs)
        .set({
          leaseExpiresAt:
            new Date(
              Date.now() - 1_000,
            ),
        })
        .where(
          eq(
            generationJobs.id,
            job.id,
          ),
        );

      await assert.rejects(
        () =>
          failGenerationJob(
            job.id,
            "worker-a",
            {
              errorCode:
                "PROVIDER_TIMEOUT",
              errorMessage:
                "Provider timed out",
              retryDelayMs: 0,
            },
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "LEASE_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "provider request id cannot be assigned to another job twice",
  async () => {
    const fixtureA =
      await createFixture();

    const fixtureB =
      await createFixture();

    try {
      const jobA =
        await createGenerationJob(
          jobInput(fixtureA),
        );

      const jobB =
        await createGenerationJob(
          jobInput(fixtureB),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      await claimNextGenerationJob(
        "worker-b",
        60_000,
      );

      await setGenerationProviderRequest(
        jobA.id,
        "worker-a",
        "higgsfield",
        "hf-global-unique-001",
      );

      await assert.rejects(
        () =>
          setGenerationProviderRequest(
            jobB.id,
            "worker-b",
            "higgsfield",
            "hf-global-unique-001",
          ),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "IDEMPOTENCY_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixtureA,
      );

      await cleanupFixture(
        fixtureB,
      );
    }
  },
);

test(
  "concurrent provider request assignment commits only one request",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await claimNextGenerationJob(
        "worker-a",
        60_000,
      );

      const results =
        await Promise.allSettled([
          setGenerationProviderRequest(
            job.id,
            "worker-a",
            "higgsfield",
            "hf-concurrent-a",
          ),
          setGenerationProviderRequest(
            job.id,
            "worker-a",
            "higgsfield",
            "hf-concurrent-b",
          ),
        ]);

      const fulfilled =
        results.filter(
          (result) =>
            result.status ===
            "fulfilled",
        );

      const rejected =
        results.filter(
          (result) =>
            result.status ===
            "rejected",
        );

      assert.equal(
        fulfilled.length,
        1,
      );

      assert.equal(
        rejected.length,
        1,
      );

      const stored =
        await getGenerationJob(
          job.id,
          {
            userId:
              fixture.userId,
          },
        );

      assert.equal(
        stored?.providerId,
        "higgsfield",
      );

      assert.ok(
        stored?.providerRequestId ===
          "hf-concurrent-a" ||
        stored?.providerRequestId ===
          "hf-concurrent-b",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "same output idempotency key is idempotent",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      const first =
        await createGenerationOutput({
          jobId:
            job.id,
          idempotencyKey:
            "generation-output-idempotent",
          type:
            "video",
          url:
            "https://example.test/idempotent.mp4",
          mimeType:
            "video/mp4",
          sizeBytes:
            1024,
        });

      const second =
        await createGenerationOutput({
          jobId:
            job.id,
          idempotencyKey:
            "generation-output-idempotent",
          type:
            "video",
          url:
            "https://example.test/idempotent.mp4",
          mimeType:
            "video/mp4",
          sizeBytes:
            1024,
        });

      assert.equal(
        second.id,
        first.id,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "reused output idempotency key with different payload is rejected",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      await createGenerationOutput({
        jobId:
          job.id,
        idempotencyKey:
          "generation-output-payload-conflict",
        type:
          "video",
        url:
          "https://example.test/first.mp4",
        mimeType:
          "video/mp4",
      });

      await assert.rejects(
        () =>
          createGenerationOutput({
            jobId:
              job.id,
            idempotencyKey:
              "generation-output-payload-conflict",
            type:
              "video",
            url:
              "https://example.test/second.mp4",
            mimeType:
              "video/mp4",
          }),
        (error: unknown) =>
          error instanceof
            GenerationRepositoryError &&
          error.code ===
            "IDEMPOTENCY_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "concurrent output creation with same idempotency key commits one row",
  async () => {
    const fixture =
      await createFixture();

    try {
      const job =
        await createGenerationJob(
          jobInput(fixture),
        );

      const results =
        await Promise.all([
          createGenerationOutput({
            jobId:
              job.id,
            idempotencyKey:
              "generation-output-concurrent",
            type:
              "video",
            url:
              "https://example.test/concurrent.mp4",
            mimeType:
              "video/mp4",
          }),
          createGenerationOutput({
            jobId:
              job.id,
            idempotencyKey:
              "generation-output-concurrent",
            type:
              "video",
            url:
              "https://example.test/concurrent.mp4",
            mimeType:
              "video/mp4",
          }),
        ]);

      assert.equal(
        results[0]?.id,
        results[1]?.id,
      );

      const rows =
        await db
          .select()
          .from(generationOutputs)
          .where(
            eq(
              generationOutputs.jobId,
              job.id,
            ),
          );

      assert.equal(
        rows.length,
        1,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);
