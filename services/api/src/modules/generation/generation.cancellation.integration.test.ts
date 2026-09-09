import { buildApp } from "../../app.js";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { createSession } from "../../common/auth/session.service.js";

import {
  authSessions,
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
  generationJobs,
  usageRecords,
  users,
} from "@ak-vision-ai/database";

import {
  reserveCredit,
  settleReservation,
} from "@ak-vision-ai/credits";

import {
  claimNextGenerationJob,
  completeGenerationJob,
  createGenerationJob,
} from "@ak-vision-ai/generation";

type Fixture = {
  userId: string;
  balanceId: string;
  reservationId: string;
  jobId: string;
  requestId: string;
  token: string;
};

async function createFixture(
  maxAttempts = 3,
): Promise<Fixture> {
  const userResult =
    await db
      .insert(users)
      .values({
        email:
          `cancel-e2e-${randomUUID()}@example.test`,
        displayName:
          "Cancellation E2E User",
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
        `cancel-e2e-reserve-${randomUUID()}`,
      referenceId:
        `cancel-e2e-${randomUUID()}`,
    });

  assert.ok(reservation);

  const requestId =
    randomUUID();

  const job =
    await createGenerationJob({
      requestId,
      userId:
        user.id,
      creditReservationId:
        reservation.id,
      type:
        "video",
      priority:
        "normal",
      providerId:
        "cancellation-test-provider",
      prompt:
        "Cancellation E2E test",
      input: {
        test:
          "cancellation",
      },
      maxAttempts,
    });

  assert.ok(job);

  const session =
    await createSession(user.id);

  assert.ok(session);

  return {
    userId:
      user.id,
    balanceId:
      balance.id,
    reservationId:
      reservation.id,
    jobId:
      job.id,
    requestId,
    token:
      session.token,
  };
}

async function cleanupFixture(
  fixture: Fixture,
): Promise<void> {
  await db.transaction(
    async (tx) => {
      await tx
        .delete(
          usageRecords,
        )
        .where(
          eq(
            usageRecords.requestId,
            fixture.requestId,
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
          generationJobs,
        )
        .where(
          eq(
            generationJobs.id,
            fixture.jobId,
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
            creditBalances.id,
            fixture.balanceId,
          ),
        );

      await tx
        .delete(
          authSessions,
        )
        .where(
          eq(
            authSessions.userId,
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

async function getBalance(
  balanceId: string,
) {
  const result =
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
          balanceId,
        ),
      )
      .limit(1);

  return result[0];
}

async function getJob(
  jobId: string,
) {
  const result =
    await db
      .select()
      .from(generationJobs)
      .where(
        eq(
          generationJobs.id,
          jobId,
        ),
      )
      .limit(1);

  return result[0];
}

async function getReservation(
  reservationId: string,
) {
  const result =
    await db
      .select()
      .from(creditReservations)
      .where(
        eq(
          creditReservations.id,
          reservationId,
        ),
      )
      .limit(1);

  return result[0];
}

async function getTransactions(
  reservationId: string,
) {
  return db
    .select()
    .from(creditTransactions)
    .where(
      eq(
        creditTransactions.reservationId,
        reservationId,
      ),
    );
}

test(
  "unauthenticated cancellation is rejected",
  async () => {
    const fixture =
      await createFixture();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method:
            "POST",
          url:
            `/api/v1/generation/${fixture.jobId}/cancel`,
        });

      assert.equal(
        response.statusCode,
        401,
      );
    } finally {
      await app.close();
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "owner can cancel queued job and atomically release its credits",
  async () => {
    const fixture =
      await createFixture();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method:
            "POST",
          url:
            `/api/v1/generation/${fixture.jobId}/cancel`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const job =
        await getJob(
          fixture.jobId,
        );

      assert.ok(job);

      assert.equal(
        job.status,
        "cancelled",
      );

      const reservation =
        await getReservation(
          fixture.reservationId,
        );

      assert.ok(reservation);

      assert.equal(
        reservation.status,
        "released",
      );

      const balance =
        await getBalance(
          fixture.balanceId,
        );

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
        await getTransactions(
          fixture.reservationId,
        );

      assert.equal(
        transactions.filter(
          (transaction) =>
            transaction.type === "hold",
        ).length,
        1,
      );

      assert.equal(
        transactions.filter(
          (transaction) =>
            transaction.type === "release",
        ).length,
        1,
      );

      assert.equal(
        transactions.filter(
          (transaction) =>
            transaction.type === "consume",
        ).length,
        0,
      );
    } finally {
      await app.close();
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "processing job can be cancelled and cannot subsequently complete",
  async () => {
    const fixture =
      await createFixture();

    const claimed =
      await claimNextGenerationJob(
        "cancellation-e2e-worker",
        5_000,
      );

    assert.ok(claimed);

    assert.equal(
      claimed.id,
      fixture.jobId,
    );

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method:
            "POST",
          url:
            `/api/v1/generation/${fixture.jobId}/cancel`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const job =
        await getJob(
          fixture.jobId,
        );

      assert.ok(job);

      assert.equal(
        job.status,
        "cancelled",
      );

      const reservation =
        await getReservation(
          fixture.reservationId,
        );

      assert.ok(reservation);

      assert.equal(
        reservation.status,
        "released",
      );

      await assert.rejects(
        () =>
          completeGenerationJob(
            fixture.jobId,
            "cancellation-e2e-worker",
            {
              cancelledAttempt:
                true,
            },
          ),
        (error: unknown) =>
          Boolean(
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: unknown }).code ===
              "LEASE_CONFLICT",
          ),
      );

      const balance =
        await getBalance(
          fixture.balanceId,
        );

      assert.ok(balance);

      assert.equal(
        balance.availableCredits,
        100,
      );

      assert.equal(
        balance.reservedCredits,
        0,
      );
    } finally {
      await app.close();
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "other authenticated user cannot cancel another user's generation job",
  async () => {
    const owner =
      await createFixture();

    const attackerUserResult =
      await db
        .insert(users)
        .values({
          email:
            `cancel-attacker-${randomUUID()}@example.test`,
          displayName:
            "Cancellation Attacker",
          role:
            "customer",
          status:
            "active",
          accountType:
            "individual",
        })
        .returning({
          id:
            users.id,
        });

    const attacker =
      attackerUserResult[0];

    assert.ok(attacker);

    const attackerSession =
      await createSession(
        attacker.id,
      );

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method:
            "POST",
          url:
            `/api/v1/generation/${owner.jobId}/cancel`,
          headers: {
            cookie:
              `ak_vision_session=${attackerSession.token}`,
          },
          payload: {},
        });

      assert.equal(
        response.statusCode,
        404,
      );

      const job =
        await getJob(
          owner.jobId,
        );

      assert.ok(job);

      assert.equal(
        job.status,
        "queued",
      );

      const reservation =
        await getReservation(
          owner.reservationId,
        );

      assert.ok(reservation);

      assert.equal(
        reservation.status,
        "reserved",
      );

      const balance =
        await getBalance(
          owner.balanceId,
        );

      assert.ok(balance);

      assert.equal(
        balance.availableCredits,
        90,
      );

      assert.equal(
        balance.reservedCredits,
        10,
      );
    } finally {
      await app.close();

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            attacker.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            attacker.id,
          ),
        );

      await cleanupFixture(
        owner,
      );
    }
  },
);

test(
  "credit reservation release endpoint is tenant-safe and idempotent for its owner",
  async () => {
    const owner =
      await createFixture();

    const attackerUserResult =
      await db
        .insert(users)
        .values({
          email:
            `release-attacker-${randomUUID()}@example.test`,
          displayName:
            "Release Attacker",
          role:
            "customer",
          status:
            "active",
          accountType:
            "individual",
        })
        .returning({
          id:
            users.id,
        });

    const attacker =
      attackerUserResult[0];

    assert.ok(attacker);

    const attackerSession =
      await createSession(
        attacker.id,
      );

    const app =
      buildApp();

    try {
      const denied =
        await app.inject({
          method:
            "POST",
          url:
            `/api/v1/credits/reservations/${owner.reservationId}/release`,
          headers: {
            cookie:
              `ak_vision_session=${attackerSession.token}`,
          },
          payload: {},
        });

      assert.equal(
        denied.statusCode,
        409,
      );

      const ownerRelease =
        await app.inject({
          method:
            "POST",
          url:
            `/api/v1/credits/reservations/${owner.reservationId}/release`,
          headers: {
            cookie:
              `ak_vision_session=${owner.token}`,
          },
          payload: {},
        });

      assert.equal(
        ownerRelease.statusCode,
        200,
      );

      const repeatedRelease =
        await app.inject({
          method:
            "POST",
          url:
            `/api/v1/credits/reservations/${owner.reservationId}/release`,
          headers: {
            cookie:
              `ak_vision_session=${owner.token}`,
          },
          payload: {},
        });

      assert.equal(
        repeatedRelease.statusCode,
        200,
      );

      const reservation =
        await getReservation(
          owner.reservationId,
        );

      assert.ok(reservation);

      assert.equal(
        reservation.status,
        "released",
      );

      const balance =
        await getBalance(
          owner.balanceId,
        );

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
        await getTransactions(
          owner.reservationId,
        );

      assert.equal(
        transactions.filter(
          (transaction) =>
            transaction.type === "release",
        ).length,
        1,
      );
    } finally {
      await app.close();

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            attacker.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            attacker.id,
          ),
        );

      /*
       * The generation job itself remains queued in this test.
       */
      await db
        .delete(generationJobs)
        .where(
          eq(
            generationJobs.id,
            owner.jobId,
          ),
        );

      await cleanupFixture(
        owner,
      );
    }
  },
);

test(
  "cancellation and settlement race has exactly one financial winner",
  async () => {
    const fixture =
      await createFixture();

    const app =
      buildApp();

    const settlementInput = {
      reservationId:
        fixture.reservationId,
      referenceId:
        fixture.requestId,
      usage: {
        requestId:
          fixture.requestId,
        providerId:
          "cancellation-race-provider",
        creditsUsed:
          10,
        currency:
          "INR",
      },
    };

    try {
      const [
        cancelResult,
        settlementResult,
      ] =
        await Promise.allSettled([
          app.inject({
            method:
              "POST",
            url:
              `/api/v1/generation/${fixture.jobId}/cancel`,
            headers: {
              cookie:
                `ak_vision_session=${fixture.token}`,
            },
          }),

          settleReservation(
            settlementInput,
            {
              userId:
                fixture.userId,
            },
          ),
        ]);

      const cancelWon =
        cancelResult.status ===
        "fulfilled" &&
        cancelResult.value.statusCode ===
          200;

      const settlementWon =
        settlementResult.status ===
        "fulfilled";

      assert.equal(
        Number(cancelWon) +
          Number(settlementWon),
        1,
      );

      const job =
        await getJob(
          fixture.jobId,
        );

      assert.ok(job);

      const reservation =
        await getReservation(
          fixture.reservationId,
        );

      assert.ok(reservation);

      const balance =
        await getBalance(
          fixture.balanceId,
        );

      assert.ok(balance);

      assert.ok(balance);

      const transactions =
        await getTransactions(
          fixture.reservationId,
        );

      const releases =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "release",
        ).length;

      const consumes =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "consume",
        ).length;

      if (cancelWon) {
        assert.equal(
          job.status,
          "cancelled",
        );

        assert.equal(
          reservation.status,
          "released",
        );

        assert.equal(
          balance.availableCredits,
          100,
        );

        assert.equal(
          balance.reservedCredits,
          0,
        );

        assert.equal(
          releases,
          1,
        );

        assert.equal(
          consumes,
          0,
        );
      } else {
        assert.equal(
          settlementWon,
          true,
        );

        assert.equal(
          job.status,
          "queued",
        );

        assert.equal(
          reservation.status,
          "consumed",
        );

        assert.equal(
          balance.availableCredits,
          90,
        );

        assert.equal(
          balance.reservedCredits,
          0,
        );

        assert.equal(
          releases,
          0,
        );

        assert.equal(
          consumes,
          1,
        );

        const usage =
          await db
            .select()
            .from(
              usageRecords,
            )
            .where(
              eq(
                usageRecords.requestId,
                fixture.requestId,
              ),
            );

        assert.equal(
          usage.length,
          1,
        );
      }
    } finally {
      await app.close();
      await cleanupFixture(
        fixture,
      );
    }
  },
);