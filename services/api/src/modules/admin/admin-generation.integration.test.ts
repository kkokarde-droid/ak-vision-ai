import {
  after,
  before,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  authSessions,
  creditBalances,
  creditReservations,
  db,
  generationJobs,
  generationOutputs,
  users,
} from "@ak-vision-ai/database";

import { buildApp } from "../../app.js";
import {
  createSession,
} from "../../common/auth/session.service.js";
import {
  SESSION_COOKIE,
} from "../../common/auth/auth.guard.js";

let app: ReturnType<
  typeof buildApp
>;

type Fixture = {
  adminUserId: string;
  adminToken: string;
  customerUserId: string;
  customerToken: string;
  balanceId: string;
  reservationId: string;
  jobId: string;
  outputId: string;
};

let fixture:
  | Fixture
  | undefined;

before(async () => {
  app = buildApp();
  await app.ready();

  const adminResult =
    await db
      .insert(users)
      .values({
        email:
          `admin-generations-${randomUUID()}@example.test`,
        displayName:
          "Generation Admin",
        role: "admin",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

  const admin = adminResult[0];
  assert.ok(admin);

  const customerResult =
    await db
      .insert(users)
      .values({
        email:
          `generation-customer-${randomUUID()}@example.test`,
        displayName:
          "Generation Customer",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

  const customer =
    customerResult[0];
  assert.ok(customer);

  const adminSession =
    await createSession(
      admin.id,
    );
  assert.ok(adminSession);

  const customerSession =
    await createSession(
      customer.id,
    );
  assert.ok(customerSession);

  const balanceResult =
    await db
      .insert(creditBalances)
      .values({
        userId: customer.id,
        organizationId: null,
        availableCredits: 1000,
        reservedCredits: 100,
        currency: "INR",
      })
      .returning({
        id: creditBalances.id,
      });

  const balance =
    balanceResult[0];
  assert.ok(balance);

  const reservationResult =
    await db
      .insert(
        creditReservations,
      )
      .values({
        creditBalanceId:
          balance.id,
        userId: customer.id,
        organizationId:
          null,
        amount: 100,
        status: "reserved",
        referenceId:
          `admin-generation-${randomUUID()}`,
        idempotencyKey:
          `admin-generation-${randomUUID()}`,
      })
      .returning({
        id:
          creditReservations.id,
      });

  const reservation =
    reservationResult[0];
  assert.ok(reservation);

  const completedAt =
    new Date();

  const jobResult =
    await db
      .insert(generationJobs)
      .values({
        requestId:
          randomUUID(),
        userId:
          customer.id,
        organizationId:
          null,
        projectId:
          null,
        conversationId:
          null,
        creditReservationId:
          reservation.id,
        type:
          "video",
        status:
          "completed",
        priority:
          "normal",
        providerId:
          "higgsfield",
        providerModelId:
          "dop-turbo",
        progress:
          100,
        prompt:
          "A cinematic product reveal in a modern studio",
        input: {
          mode:
            "image_to_video",
          duration:
            5,
          enhance_prompt:
            true,
          imageAssetId:
            randomUUID(),
        },
        pricingSnapshot: {
          quote: {
            creditsRequired:
              400,
          },
        },
        output: {
          ready: true,
        },
        attemptCount:
          1,
        maxAttempts:
          3,
        startedAt:
          new Date(
            completedAt.getTime() -
              5000,
          ),
        completedAt,
      })
      .returning({
        id:
          generationJobs.id,
      });

  const job = jobResult[0];
  assert.ok(job);

  const outputResult =
    await db
      .insert(generationOutputs)
      .values({
        idempotencyKey:
          `admin-output-${randomUUID()}`,
        jobId:
          job.id,
        artifactId:
          null,
        type:
          "video",
        url:
          "/private/output/video.mp4",
        mimeType:
          "video/mp4",
        sizeBytes:
          123456,
        metadata:
          {
            durationSeconds:
              5,
          },
      })
      .returning({
        id:
          generationOutputs.id,
      });

  const output =
    outputResult[0];
  assert.ok(output);

  fixture = {
    adminUserId:
      admin.id,
    adminToken:
      adminSession.token,
    customerUserId:
      customer.id,
    customerToken:
      customerSession.token,
    balanceId:
      balance.id,
    reservationId:
      reservation.id,
    jobId:
      job.id,
    outputId:
      output.id,
  };
});

after(async () => {
  if (fixture) {
    await db
      .delete(generationOutputs)
      .where(
        eq(
          generationOutputs.id,
          fixture.outputId,
        ),
      );

    await db
      .delete(generationJobs)
      .where(
        eq(
          generationJobs.id,
          fixture.jobId,
        ),
      );

    await db
      .delete(creditReservations)
      .where(
        eq(
          creditReservations.id,
          fixture.reservationId,
        ),
      );

    await db
      .delete(creditBalances)
      .where(
        eq(
          creditBalances.id,
          fixture.balanceId,
        ),
      );

    await db
      .delete(authSessions)
      .where(
        eq(
          authSessions.userId,
          fixture.adminUserId,
        ),
      );

    await db
      .delete(authSessions)
      .where(
        eq(
          authSessions.userId,
          fixture.customerUserId,
        ),
      );

    await db
      .delete(users)
      .where(
        eq(
          users.id,
          fixture.adminUserId,
        ),
      );

    await db
      .delete(users)
      .where(
        eq(
          users.id,
          fixture.customerUserId,
        ),
      );
  }

  await app.close();
});

test(
  "admin generation list rejects anonymous access",
  async () => {
    const response =
      await app.inject({
        method: "GET",
        url: "/api/v1/admin/generations",
      });

    assert.equal(
      response.statusCode,
      401,
    );
  },
);

test(
  "admin generation list rejects customer access",
  async () => {
    assert.ok(fixture);

    const response =
      await app.inject({
        method: "GET",
        url: "/api/v1/admin/generations",
        cookies: {
          [SESSION_COOKIE]:
            fixture.customerToken,
        },
      });

    assert.equal(
      response.statusCode,
      403,
    );
  },
);

test(
  "admin generation list returns real job data",
  async () => {
    assert.ok(fixture);

    const response =
      await app.inject({
        method: "GET",
        url:
          "/api/v1/admin/generations?page=1&pageSize=10&status=completed&search=Generation%20Customer",
        cookies: {
          [SESSION_COOKIE]:
            fixture.adminToken,
        },
      });

    assert.equal(
      response.statusCode,
      200,
    );

    const payload =
      response.json() as {
        status: string;
        data: Array<{
          id: string;
          mode: string;
          status: string;
          durationSeconds:
            | number
            | null;
          creditsRequired:
            | number
            | null;
          outputCount: number;
          customer: {
            email: string;
          };
        }>;
        meta: {
          total: number;
        };
      };

    assert.equal(
      payload.status,
      "ok",
    );
    assert.equal(
      payload.meta.total,
      1,
    );
    assert.equal(
      payload.data.length,
      1,
    );
    assert.equal(
      payload.data[0]?.id,
      fixture.jobId,
    );
    assert.equal(
      payload.data[0]?.mode,
      "image_to_video",
    );
    assert.equal(
      payload.data[0]?.status,
      "completed",
    );
    assert.equal(
      payload.data[0]?.durationSeconds,
      5,
    );
    assert.equal(
      payload.data[0]?.creditsRequired,
      400,
    );
    assert.equal(
      payload.data[0]?.outputCount,
      1,
    );
    assert.match(
      payload.data[0]?.customer.email ?? "",
      /@example\.test$/,
    );
  },
);

test(
  "admin generation detail returns sanitized operational data",
  async () => {
    assert.ok(fixture);

    const response =
      await app.inject({
        method: "GET",
        url:
          `/api/v1/admin/generations/${fixture.jobId}`,
        cookies: {
          [SESSION_COOKIE]:
            fixture.adminToken,
        },
      });

    assert.equal(
      response.statusCode,
      200,
    );

    const payload =
      response.json() as {
        status: string;
        data: {
          prompt: string;
          outputs: Array<{
            mimeType: string;
            sizeBytes:
              | number
              | null;
          }>;
          input: {
            durationSeconds:
              | number
              | null;
            imageAssetProvided:
              | boolean;
          };
          pricingSnapshot?:
            unknown;
          pricing?:
            unknown;
        };
      };

    assert.equal(
      payload.status,
      "ok",
    );
    assert.equal(
      payload.data.prompt,
      "A cinematic product reveal in a modern studio",
    );
    assert.equal(
      payload.data.input.durationSeconds,
      5,
    );
    assert.equal(
      payload.data.input.imageAssetProvided,
      true,
    );
    assert.equal(
      payload.data.outputs.length,
      1,
    );
    assert.equal(
      payload.data.outputs[0]?.mimeType,
      "video/mp4",
    );
    assert.equal(
      payload.data.outputs[0]?.sizeBytes,
      123456,
    );
    assert.equal(
      "pricingSnapshot" in payload.data,
      false,
    );
    assert.equal(
      "pricing" in payload.data,
      false,
    );
  },
);

test(
  "admin generation detail returns 404 for unknown job",
  async () => {
    assert.ok(fixture);

    const response =
      await app.inject({
        method: "GET",
        url:
          `/api/v1/admin/generations/${randomUUID()}`,
        cookies: {
          [SESSION_COOKIE]:
            fixture.adminToken,
        },
      });

    assert.equal(
      response.statusCode,
      404,
    );
  },
);
