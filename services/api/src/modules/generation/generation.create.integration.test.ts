import {
before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { buildApp } from "../../app.js";
import { createSession } from "../../common/auth/session.service.js";

import {
  authSessions,
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
  generationJobs,
  generationOutputs,
  organizations,
  pricingPolicies,
  providerPricing,
  users,
  artifacts,
} from "@ak-vision-ai/database";

type Fixture = {
  userId: string;
  balanceId: string;
  token: string;
  organizationId?: string;
};

let app: ReturnType<typeof buildApp>;

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

async function createUserFixture(
  availableCredits = 2000,
): Promise<Fixture> {
  const userResult = await db
    .insert(users)
    .values({
      email:
        `generation-create-e2e-${randomUUID()}@example.test`,
      displayName:
        "Generation Create E2E User",
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
      availableCredits,
      reservedCredits: 0,
      currency: "INR",
    })
    .returning({
      id: creditBalances.id,
    });

  const balance = balanceResult[0];
  assert.ok(balance);

  const session =
    await createSession(user.id);

  assert.ok(session);

  return {
    userId: user.id,
    balanceId: balance.id,
    token: session.token,
  };
}

async function createOrganizationFixture(
  availableCredits = 2000,
): Promise<Fixture> {
  const userResult = await db
    .insert(users)
    .values({
      email:
        `generation-org-owner-${randomUUID()}@example.test`,
      displayName:
        "Generation Organization Owner",
      role: "customer",
      status: "active",
      accountType: "individual",
    })
    .returning({
      id: users.id,
    });

  const user = userResult[0];
  assert.ok(user);

  const organizationResult =
    await db
      .insert(organizations)
      .values({
        name:
          `Generation Test Org ${randomUUID()}`,
        ownerUserId:
          user.id,
      })
      .returning({
        id: organizations.id,
      });

  const organization =
    organizationResult[0];
  assert.ok(organization);

  const balanceResult = await db
    .insert(creditBalances)
    .values({
      userId: null,
      organizationId:
        organization.id,
      availableCredits,
      reservedCredits: 0,
      currency: "INR",
    })
    .returning({
      id: creditBalances.id,
    });

  const balance = balanceResult[0];
  assert.ok(balance);

  const session =
    await createSession(user.id);

  assert.ok(session);

  return {
    userId: user.id,
    balanceId: balance.id,
    token: session.token,
    organizationId:
      organization.id,
  };
}

async function cleanupFixture(
  fixture: Fixture,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (fixture.organizationId) {
      await tx
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.organizationId,
            fixture.organizationId,
          ),
        );

      await tx
        .delete(generationJobs)
        .where(
          eq(
            generationJobs.organizationId,
            fixture.organizationId,
          ),
        );

      await tx
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.organizationId,
            fixture.organizationId,
          ),
        );

      await tx
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.organizationId,
            fixture.organizationId,
          ),
        );

      await tx
        .delete(organizations)
        .where(
          eq(
            organizations.id,
            fixture.organizationId,
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
      .delete(creditTransactions)
      .where(
        eq(
          creditTransactions.userId,
          fixture.userId,
        ),
      );

    await tx
      .delete(creditReservations)
      .where(
        eq(
          creditReservations.userId,
          fixture.userId,
        ),
      );

    await tx
      .delete(authSessions)
      .where(
        eq(
          authSessions.userId,
          fixture.userId,
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

function generationPayload(
  requestId: string,
) {
  return {
    requestId,
    providerModelId:
      "dop-turbo" as const,
    prompt:
      "Create a cinematic product video",
    imageUrl:
      "https://example.test/input.jpg",
    durationSeconds: 5 as const,
  };
}

async function getUserBalance(
  userId: string,
) {
  const rows = await db
    .select()
    .from(creditBalances)
    .where(
      eq(
        creditBalances.userId,
        userId,
      ),
    )
    .limit(1);

  return rows[0];
}

test(
  "creates generation job with authoritative pricing, reservation and snapshot",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        response.statusCode,
        201,
      );

      const body =
        response.json() as {
          status: string;
          data: {
            job: {
              id: string;
              requestId: string;
              creditReservationId: string;
              providerId: string | null;
              providerModelId: string | null;
              pricingSnapshot: unknown;
              input: Record<
                string,
                unknown
              > | null;
            };
            pricing: {
              pricingVersion: string;
              creditsRequired: number;
              customerChargeMinor: number;
            };
            replayed: boolean;
          };
        };

      assert.equal(
        body.status,
        "ok",
      );

      assert.equal(
        body.data.replayed,
        false,
      );

      assert.equal(
        body.data.job.requestId,
        requestId,
      );

      assert.equal(
        body.data.job.providerId,
        "higgsfield",
      );

      assert.equal(
        body.data.job.providerModelId,
        "dop-turbo",
      );

      assert.equal(
        body.data.pricing.pricingVersion,
        "v1-dev",
      );

      assert.equal(
        body.data.pricing.creditsRequired,
        500,
      );

      assert.equal(
        body.data.pricing.customerChargeMinor,
        50000,
      );

      const jobResult =
        await db
          .select()
          .from(generationJobs)
          .where(
            eq(
              generationJobs.id,
              body.data.job.id,
            ),
          )
          .limit(1);

      const job = jobResult[0];
      assert.ok(job);

      assert.deepEqual(
        job.pricingSnapshot,
        body.data.job.pricingSnapshot,
      );

      const reservationResult =
        await db
          .select()
          .from(creditReservations)
          .where(
            and(
              eq(
                creditReservations.userId,
                fixture.userId,
              ),
              eq(
                creditReservations.idempotencyKey,
                `generation:${requestId}`,
              ),
            ),
          )
          .limit(1);

      const reservation =
        reservationResult[0];

      assert.ok(reservation);
      assert.equal(
        reservation.amount,
        500,
      );
      assert.equal(
        reservation.status,
        "reserved",
      );

      const balance =
        await getUserBalance(
          fixture.userId,
        );

      assert.ok(balance);
      assert.equal(
        balance.availableCredits,
        1500,
      );
      assert.equal(
        balance.reservedCredits,
        500,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "same requestId with same payload is idempotent and does not double reserve",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const first =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      const second =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        first.statusCode,
        201,
      );

      assert.equal(
        second.statusCode,
        200,
      );

      const firstBody =
        first.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      const secondBody =
        second.json() as {
          data: {
            job: {
              id: string;
            };
            replayed: boolean;
          };
        };

      assert.equal(
        secondBody.data.replayed,
        true,
      );

      assert.equal(
        secondBody.data.job.id,
        firstBody.data.job.id,
      );

      const reservations =
        await db
          .select()
          .from(creditReservations)
          .where(
            and(
              eq(
                creditReservations.userId,
                fixture.userId,
              ),
              eq(
                creditReservations.idempotencyKey,
                `generation:${requestId}`,
              ),
            ),
          );

      assert.equal(
        reservations.length,
        1,
      );

      const balance =
        await getUserBalance(
          fixture.userId,
        );

      assert.ok(balance);
      assert.equal(
        balance.availableCredits,
        1500,
      );
      assert.equal(
        balance.reservedCredits,
        500,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "same requestId with changed duration is rejected",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const first =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        first.statusCode,
        201,
      );

      const changed =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload: {
            ...generationPayload(
              requestId,
            ),
            durationSeconds: 3,
          },
        });

      assert.equal(
        changed.statusCode,
        409,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "same requestId with changed priority is rejected",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const firstPayload =
        generationPayload(
          requestId,
        );

      const first =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            firstPayload,
        });

      assert.equal(
        first.statusCode,
        201,
      );

      const changed =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload: {
            ...firstPayload,
            priority: "high",
          },
        });

      assert.equal(
        changed.statusCode,
        409,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "concurrent identical requests create exactly one job and reservation",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const responses =
        await Promise.all(
          Array.from(
            { length: 10 },
            () =>
              app.inject({
                method: "POST",
                url:
                  "/api/v1/generation",
                headers: {
                  cookie:
                    `ak_vision_session=${fixture.token}`,
                },
                payload:
                  generationPayload(
                    requestId,
                  ),
              }),
          ),
        );

      assert.equal(
        responses.filter(
          (response) =>
            response.statusCode ===
            201,
        ).length,
        1,
      );

      assert.equal(
        responses.filter(
          (response) =>
            response.statusCode ===
            200,
        ).length,
        9,
      );

      assert.equal(
        responses.filter(
          (response) =>
            response.statusCode !==
            200 &&
            response.statusCode !==
            201,
        ).length,
        0,
      );

      const jobs =
        await db
          .select()
          .from(generationJobs)
          .where(
            eq(
              generationJobs.requestId,
              requestId,
            ),
          );

      assert.equal(
        jobs.length,
        1,
      );

      const reservations =
        await db
          .select()
          .from(creditReservations)
          .where(
            and(
              eq(
                creditReservations.userId,
                fixture.userId,
              ),
              eq(
                creditReservations.idempotencyKey,
                `generation:${requestId}`,
              ),
            ),
          );

      assert.equal(
        reservations.length,
        1,
      );

      const balance =
        await getUserBalance(
          fixture.userId,
        );

      assert.ok(balance);
      assert.equal(
        balance.availableCredits,
        1500,
      );
      assert.equal(
        balance.reservedCredits,
        500,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "different user cannot reuse another user's requestId",
  async () => {
    const owner =
      await createUserFixture();

    const attacker =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const first =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${owner.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        first.statusCode,
        201,
      );

      const second =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${attacker.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        second.statusCode,
        409,
      );

      const attackerBalance =
        await getUserBalance(
          attacker.userId,
        );

      assert.ok(
        attackerBalance,
      );
      assert.equal(
        attackerBalance.availableCredits,
        2000,
      );
      assert.equal(
        attackerBalance.reservedCredits,
        0,
      );
    } finally {
      await cleanupFixture(
        owner,
      );
      await cleanupFixture(
        attacker,
      );
    }
  },
);

test(
  "insufficient credits prevents reservation and job creation",
  async () => {
    const fixture =
      await createUserFixture(
        100,
      );

    try {
      const requestId =
        randomUUID();

      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        response.statusCode,
        402,
      );

      const jobs =
        await db
          .select()
          .from(generationJobs)
          .where(
            eq(
              generationJobs.requestId,
              requestId,
            ),
          );

      assert.equal(
        jobs.length,
        0,
      );

      const reservations =
        await db
          .select()
          .from(creditReservations)
          .where(
            eq(
              creditReservations.userId,
              fixture.userId,
            ),
          );

      assert.equal(
        reservations.length,
        0,
      );

      const balance =
        await getUserBalance(
          fixture.userId,
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
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "unknown pricing for an otherwise valid model is rejected",
  async () => {
    const fixture =
      await createUserFixture();

    let savedPricing:
      typeof providerPricing.$inferSelect | undefined;

    try {
      const rows =
        await db
          .select()
          .from(providerPricing)
          .where(
            eq(
              providerPricing.providerModelId,
              "dop-standard",
            ),
          )
          .limit(1);

      savedPricing =
        rows[0];

      assert.ok(
        savedPricing,
      );

      await db
        .delete(providerPricing)
        .where(
          eq(
            providerPricing.id,
            savedPricing.id,
          ),
        );

      const requestId =
        randomUUID();

      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload: {
            ...generationPayload(
              requestId,
            ),
            providerModelId:
              "dop-standard",
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );

      const balance =
        await getUserBalance(
          fixture.userId,
        );

      assert.ok(balance);
      assert.equal(
        balance.availableCredits,
        2000,
      );
      assert.equal(
        balance.reservedCredits,
        0,
      );
    } finally {
      if (savedPricing) {
        await db
          .insert(providerPricing)
          .values(savedPricing);
      }

      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "client financial fields cannot control pricing",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload: {
            ...generationPayload(
              requestId,
            ),
            creditsRequired: 1,
            customerChargeMinor: 1,
            providerCostMinor: 1,
            platformContributionMinor: 0,
          },
        });

      assert.equal(
        response.statusCode,
        400,
      );

      const balance =
        await getUserBalance(
          fixture.userId,
        );

      assert.ok(balance);
      assert.equal(
        balance.availableCredits,
        2000,
      );
      assert.equal(
        balance.reservedCredits,
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
  "organization owner can create generation against organization credits",
  async () => {
    const fixture =
      await createOrganizationFixture();

    try {
      const requestId =
        randomUUID();

      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload: {
            ...generationPayload(
              requestId,
            ),
            organizationId:
              fixture.organizationId,
          },
        });

      assert.equal(
        response.statusCode,
        201,
      );

      const balanceResult =
        await db
          .select()
          .from(creditBalances)
          .where(
            eq(
              creditBalances.organizationId,
              fixture.organizationId!,
            ),
          )
          .limit(1);

      const balance =
        balanceResult[0];

      assert.ok(balance);
      assert.equal(
        balance.availableCredits,
        1500,
      );
      assert.equal(
        balance.reservedCredits,
        500,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "unauthorized user cannot charge another organization",
  async () => {
    const owner =
      await createOrganizationFixture();

    const attacker =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${attacker.token}`,
          },
          payload: {
            ...generationPayload(
              requestId,
            ),
            organizationId:
              owner.organizationId,
          },
        });

      assert.equal(
        response.statusCode,
        409,
      );

      const ownerBalanceResult =
        await db
          .select()
          .from(creditBalances)
          .where(
            eq(
              creditBalances.organizationId,
              owner.organizationId!,
            ),
          )
          .limit(1);

      const ownerBalance =
        ownerBalanceResult[0];

      assert.ok(ownerBalance);
      assert.equal(
        ownerBalance.availableCredits,
        2000,
      );
      assert.equal(
        ownerBalance.reservedCredits,
        0,
      );

      const attackerBalance =
        await getUserBalance(
          attacker.userId,
        );

      assert.ok(attackerBalance);
      assert.equal(
        attackerBalance.availableCredits,
        2000,
      );
      assert.equal(
        attackerBalance.reservedCredits,
        0,
      );
    } finally {
      await cleanupFixture(
        owner,
      );
      await cleanupFixture(
        attacker,
      );
    }
  },
);

/*
 * ============================================================
 * P2-E READ API INTEGRATION TESTS
 * ============================================================
 *
 * These tests reuse the existing generation-create fixtures and
 * cleanup path. Customer-facing reads are verified for:
 *
 * - ownership isolation
 * - organization isolation
 * - input validation
 * - safe status projection
 * - failed/cancelled projection
 * - output access control
 * - output field non-leakage
 *
 * Internal/provider/financial fields must never escape through
 * the customer read API.
 */

test(
  "P2-E own generation status is readable with customer-safe projection",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      const jobId =
        created.data.job.id;

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const body =
        response.json() as {
          status: string;
          data: Record<
            string,
            unknown
          >;
        };

      assert.equal(
        body.status,
        "ok",
      );

      assert.equal(
        body.data.id,
        jobId,
      );

      assert.equal(
        body.data.requestId,
        requestId,
      );

      assert.equal(
        body.data.status,
        "queued",
      );

      assert.equal(
        body.data.progress,
        0,
      );

      assert.ok(
        !("creditReservationId" in body.data),
      );

      assert.ok(
        !("pricingSnapshot" in body.data),
      );

      assert.ok(
        !("providerRequestId" in body.data),
      );

      assert.ok(
        !("providerId" in body.data),
      );

      assert.ok(
        !("input" in body.data),
      );

      assert.ok(
        !("attemptCount" in body.data),
      );

      assert.ok(
        !("maxAttempts" in body.data),
      );

      assert.ok(
        !("lockedAt" in body.data),
      );

      assert.ok(
        !("lockedBy" in body.data),
      );

      assert.ok(
        !("leaseExpiresAt" in body.data),
      );

      assert.ok(
        !("errorCode" in body.data),
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "P2-E invalid generation id is rejected by runtime validation",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const response =
        await app.inject({
          method: "GET",
          url:
            "/api/v1/generation/not-a-uuid",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        400,
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "P2-E another user cannot read an owner's generation",
  async () => {
    const owner =
      await createUserFixture();

    const attacker =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${owner.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      const jobId =
        created.data.job.id;

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}`,
          headers: {
            cookie:
              `ak_vision_session=${attacker.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );
    } finally {
      await cleanupFixture(
        owner,
      );

      await cleanupFixture(
        attacker,
      );
    }
  },
);

test(
  "P2-E organization generation requires the matching organization context",
  async () => {
    const owner =
      await createOrganizationFixture();

    const otherOrganization =
      await createOrganizationFixture();

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${owner.token}`,
          },
          payload: {
            ...generationPayload(
              requestId,
            ),
            organizationId:
              owner.organizationId,
          },
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      const jobId =
        created.data.job.id;

      const correctContext =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}?organizationId=${owner.organizationId}`,
          headers: {
            cookie:
              `ak_vision_session=${owner.token}`,
          },
        });

      assert.equal(
        correctContext.statusCode,
        200,
      );

      const wrongContext =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}?organizationId=${otherOrganization.organizationId}`,
          headers: {
            cookie:
              `ak_vision_session=${owner.token}`,
          },
        });

      assert.equal(
        wrongContext.statusCode,
        404,
      );
    } finally {
      await cleanupFixture(
        owner,
      );

      await cleanupFixture(
        otherOrganization,
      );
    }
  },
);

test(
  "P2-E missing generation returns 404 without revealing internal state",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const missingJobId =
        randomUUID();

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${missingJobId}`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );

      const body =
        response.json() as {
          status: string;
          code: string;
          message: string;
        };

      assert.equal(
        body.status,
        "error",
      );

      assert.equal(
        body.code,
        "NOT_FOUND",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "P2-E failed generation exposes customer-safe failure information only",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      const jobId =
        created.data.job.id;

      await db
        .update(generationJobs)
        .set({
          status: "failed",
          errorCode:
            "INTERNAL_TEST_ONLY",
          errorMessage:
            "Customer-visible failure",
          completedAt:
            new Date(),
        })
        .where(
          eq(
            generationJobs.id,
            jobId,
          ),
        );

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const body =
        response.json() as {
          data: Record<
            string,
            unknown
          >;
        };

      assert.equal(
        body.data.status,
        "failed",
      );

      assert.deepEqual(
        body.data.error,
        {
          message:
            "Customer-visible failure",
        },
      );

      assert.ok(
        !("errorCode" in body.data),
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "P2-E cancelled generation remains customer-readable without internal fields",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      const jobId =
        created.data.job.id;

      await db
        .update(generationJobs)
        .set({
          status: "cancelled",
          completedAt:
            new Date(),
          errorCode: null,
          errorMessage: null,
        })
        .where(
          eq(
            generationJobs.id,
            jobId,
          ),
        );

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const body =
        response.json() as {
          data: Record<
            string,
            unknown
          >;
        };

      assert.equal(
        body.data.status,
        "cancelled",
      );

      assert.equal(
        body.data.error,
        null,
      );

      assert.ok(
        !("creditReservationId" in body.data),
      );

      assert.ok(
        !("providerRequestId" in body.data),
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "P2-E own generation outputs are readable and internal output fields are not leaked",
  async () => {
    const fixture =
      await createUserFixture();

    let jobId:
      | string
      | undefined;

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      jobId =
        created.data.job.id;

      await db
        .insert(generationOutputs)
        .values({
          jobId,
          type: "video",
          url:
            "https://cdn.example.test/output.mp4",
          mimeType:
            "video/mp4",
          sizeBytes:
            123456,
          metadata: {
            internalProvider:
              "test-provider",
            secret:
              "must-not-leak",
          },
          idempotencyKey:
            `read-test:${requestId}`,
        });

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}/output`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const body =
        response.json() as {
          status: string;
          data: Array<
            Record<string, unknown>
          >;
        };

      assert.equal(
        body.status,
        "ok",
      );

      assert.equal(
        body.data.length,
        1,
      );

      const output =
        body.data[0];

      assert.ok(output);

      assert.equal(
        output.type,
        "video",
      );

      assert.equal(
  typeof output.url,
  "string",
);

assert.match(
  output.url as string,
  /^\/api\/v1\/generation\/[0-9a-f-]+\/output\/[0-9a-f-]+$/,
);

      assert.equal(
        output.mimeType,
        "video/mp4",
      );

      assert.equal(
        output.sizeBytes,
        123456,
      );

      assert.ok(
        !("idempotencyKey" in output),
      );

      assert.ok(
        !("metadata" in output),
      );

      assert.ok(
        !("jobId" in output),
      );
    } finally {
      if (jobId) {
        await db
          .delete(generationOutputs)
          .where(
            eq(
              generationOutputs.jobId,
              jobId,
            ),
          );
      }

      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "P2-E generation with no outputs returns an empty output list",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      const jobId =
        created.data.job.id;

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}/output`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const body =
        response.json() as {
          status: string;
          data: unknown[];
        };

      assert.equal(
        body.status,
        "ok",
      );

      assert.deepEqual(
        body.data,
        [],
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);

test(
  "P2-E another user cannot read generation outputs",
  async () => {
    const owner =
      await createUserFixture();

    const attacker =
      await createUserFixture();

    let jobId:
      | string
      | undefined;

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${owner.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      jobId =
        created.data.job.id;

      await db
        .insert(generationOutputs)
        .values({
          jobId,
          type: "video",
          url:
            "https://cdn.example.test/private.mp4",
          mimeType:
            "video/mp4",
          idempotencyKey:
            `output-access:${requestId}`,
        });

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}/output`,
          headers: {
            cookie:
              `ak_vision_session=${attacker.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );
    } finally {
      if (jobId) {
        await db
          .delete(generationOutputs)
          .where(
            eq(
              generationOutputs.jobId,
              jobId,
            ),
          );
      }

      await cleanupFixture(
        owner,
      );

      await cleanupFixture(
        attacker,
      );
    }
  },
);

test(
  "P2-E missing generation output endpoint does not reveal whether outputs exist",
  async () => {
    const fixture =
      await createUserFixture();

    try {
      const missingJobId =
        randomUUID();

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${missingJobId}/output`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );

      const body =
        response.json() as {
          status: string;
          code: string;
        };

      assert.equal(
        body.status,
        "error",
      );

      assert.equal(
        body.code,
        "NOT_FOUND",
      );
    } finally {
      await cleanupFixture(
        fixture,
      );
    }
  },
);



test(
  "P3-61D authenticated output streams stored media bytes",
  async () => {
    const fixture =
      await createUserFixture();

    let jobId:
      | string
      | undefined;

    let artifactId:
      | string
      | undefined;

    let outputId:
      | string
      | undefined;

    const storageKey =
      `generations/${randomUUID()}/final.mp4`;

    try {
      const requestId =
        randomUUID();

      const createResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/generation",
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
          payload:
            generationPayload(
              requestId,
            ),
        });

      assert.equal(
        createResponse.statusCode,
        201,
      );

      const created =
        createResponse.json() as {
          data: {
            job: {
              id: string;
            };
          };
        };

      jobId =
        created.data.job.id;

      const mediaBytes =
        Buffer.from(
          "AK-VISION-AI-P3-61D-MEDIA-E2E",
          "utf8",
        );

      const {
        mkdir,
        writeFile,
        rm,
      } =
        await import(
          "node:fs/promises"
        );

      const {
        join,
        resolve,
      } =
        await import(
          "node:path"
        );

      const storageRoot =
        process.env.MEDIA_STORAGE_ROOT?.trim() ||
        resolve(
          process.cwd(),
          "..",
          "worker",
          "worker-storage",
        );

      const physicalPath =
        join(
          storageRoot,
          ...storageKey.split("/"),
        );

      await mkdir(
        resolve(
          physicalPath,
          "..",
        ),
        {
          recursive: true,
        },
      );

      await writeFile(
        physicalPath,
        mediaBytes,
      );

      const artifactResult =
        await db
          .insert(artifacts)
          .values({
            ownerUserId:
              fixture.userId,
            organizationId:
              null,
            name:
              "Generated Reel.mp4",
            storageKey,
            storageUrl:
              `storage://local/${storageKey}`,
            type:
              "video",
            status:
              "ready",
            version:
              1,
            mimeType:
              "video/mp4",
            sizeBytes:
              mediaBytes.length,
            metadata: {
              source:
                "p3-61d-stream-e2e",
            },
          })
          .returning({
            id:
              artifacts.id,
          });

      artifactId =
        artifactResult[0]?.id;

      assert.ok(
        artifactId,
      );

      const outputResult =
        await db
          .insert(generationOutputs)
          .values({
            jobId,
            artifactId,
            type:
              "video",
            url:
              `storage://local/${storageKey}`,
            mimeType:
              "video/mp4",
            sizeBytes:
              mediaBytes.length,
            metadata: {
              internalProvider:
                "must-not-leak",
            },
            idempotencyKey:
              `p3-61d-stream:${requestId}`,
          })
          .returning({
            id:
              generationOutputs.id,
          });

      outputId =
        outputResult[0]?.id;

      assert.ok(
        outputId,
      );

      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/generation/${jobId}/output/${outputId}`,
          headers: {
            cookie:
              `ak_vision_session=${fixture.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      assert.equal(
        response.headers["content-type"],
        "video/mp4",
      );

      assert.equal(
        response.headers["content-length"],
        String(
          mediaBytes.length,
        ),
      );

      assert.equal(
        response.headers[
          "content-disposition"
        ],
        'inline; filename="Generated Video.mp4"',
      );

      assert.equal(
        response.headers[
          "cache-control"
        ],
        "private, no-store",
      );

      assert.deepEqual(
        Buffer.from(
          response.rawPayload,
        ),
        mediaBytes,
      );

      console.log(
        "P3-61D authenticated media streaming: GREEN",
      );

      await rm(
        physicalPath,
        {
          force: true,
        },
      );
    } finally {
      if (outputId) {
        await db
          .delete(generationOutputs)
          .where(
            eq(
              generationOutputs.id,
              outputId,
            ),
          );
      }

      if (artifactId) {
        await db
          .delete(artifacts)
          .where(
            eq(
              artifacts.id,
              artifactId,
            ),
          );
      }

      await cleanupFixture(
        fixture,
      );
    }
  },
);


