import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import {
  authSessions,
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
  usageRecords,
  users,
} from "@ak-vision-ai/database";

import { grantCredits } from "@ak-vision-ai/credits";
import { buildApp } from "../../app.js";
import { createSession } from "../../common/auth/session.service.js";
import { SESSION_COOKIE } from "../../common/auth/auth.guard.js";

let app: ReturnType<typeof buildApp>;

type Fixture = {
  adminId: string;
  adminToken: string;
  customerId: string;
  customerToken: string;
  balanceId?: string;
};

async function createFixture(): Promise<Fixture> {
  const adminResult = await db.insert(users).values({
    email: `admin-credits-${randomUUID()}@example.test`,
    displayName: "Credits Admin",
    role: "admin",
    status: "active",
    accountType: "individual",
  }).returning({ id: users.id });
  const admin = adminResult[0];
  assert.ok(admin);

  const customerResult = await db.insert(users).values({
    email: `credits-customer-${randomUUID()}@example.test`,
    displayName: "Credits Customer",
    role: "customer",
    status: "active",
    accountType: "individual",
  }).returning({ id: users.id });
  const customer = customerResult[0];
  assert.ok(customer);

  const adminSession = await createSession(admin.id);
  const customerSession = await createSession(customer.id);
  assert.ok(adminSession);
  assert.ok(customerSession);

  return {
    adminId: admin.id,
    adminToken: adminSession.token,
    customerId: customer.id,
    customerToken: customerSession.token,
  };
}

async function cleanupFixture(fixture: Fixture) {
  await db.transaction(async (tx) => {
    await tx.delete(usageRecords).where(eq(usageRecords.userId, fixture.customerId));
    await tx.delete(creditTransactions).where(eq(creditTransactions.userId, fixture.customerId));
    await tx.delete(creditReservations).where(eq(creditReservations.userId, fixture.customerId));
    await tx.delete(authSessions).where(eq(authSessions.userId, fixture.customerId));
    await tx.delete(authSessions).where(eq(authSessions.userId, fixture.adminId));
    await tx.delete(creditBalances).where(eq(creditBalances.userId, fixture.customerId));
    await tx.delete(users).where(eq(users.id, fixture.customerId));
    await tx.delete(users).where(eq(users.id, fixture.adminId));
  });
}

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

test("admin credit list rejects anonymous access", async () => {
  const fixture = await createFixture();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/credits",
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("admin credit list rejects customer access", async () => {
  const fixture = await createFixture();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/credits",
      headers: { cookie: `${SESSION_COOKIE}=${fixture.customerToken}` },
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("admin credit list returns customer balance data", async () => {
  const fixture = await createFixture();
  try {
    await grantCredits({
      userId: fixture.customerId,
      amount: 250,
      source: "admin",
      referenceId: `test-admin-grant-${randomUUID()}`,
      idempotencyKey: `test-admin-grant-${randomUUID()}`,
      description: "Test balance seed",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/credits?search=Credits%20Customer",
      headers: { cookie: `${SESSION_COOKIE}=${fixture.adminToken}` },
    });
    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.equal(body.status, "ok");
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].customer.id, fixture.customerId);
    assert.equal(body.data[0].balance.availableCredits, 250);
    assert.equal(body.data[0].balance.reservedCredits, 0);
    assert.equal(body.data[0].totalCredits, 250);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("admin credit detail returns transactions, reservations and usage", async () => {
  const fixture = await createFixture();
  try {
    await grantCredits({
      userId: fixture.customerId,
      amount: 300,
      source: "admin",
      referenceId: `test-detail-${randomUUID()}`,
      idempotencyKey: `test-detail-${randomUUID()}`,
      description: "Detail seed",
    });

    await db.insert(usageRecords).values({
      requestId: randomUUID(),
      reservationId: null,
      userId: fixture.customerId,
      organizationId: null,
      providerId: "test-provider",
      providerModelId: "test-model",
      creditsUsed: 75,
      currency: "INR",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/credits/${fixture.customerId}`,
      headers: { cookie: `${SESSION_COOKIE}=${fixture.adminToken}` },
    });
    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.equal(body.status, "ok");
    assert.equal(body.data.customer.id, fixture.customerId);
    assert.equal(body.data.balance.availableCredits, 300);
    assert.equal(body.data.transactions.length, 1);
    assert.equal(body.data.transactions[0].source, "admin");
    assert.equal(body.data.usage.length, 1);
    assert.equal(body.data.usage[0].creditsUsed, 75);
    assert.equal("idempotencyKey" in body.data.transactions[0], false);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("admin credit grant succeeds and records an admin ledger transaction", async () => {
  const fixture = await createFixture();
  try {
    const idempotencyKey = `admin-grant-${randomUUID()}`;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/credits/${fixture.customerId}/grant`,
      headers: { cookie: `${SESSION_COOKIE}=${fixture.adminToken}` },
      payload: {
        amount: 500,
        description: "Support compensation",
        referenceId: "SUPPORT-001",
        idempotencyKey,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, "ok");
    assert.equal(body.data.transaction.source, "admin");
    assert.equal(body.data.transaction.type, "grant");
    assert.equal(body.data.transaction.amount, 500);
    assert.equal(body.data.balance.availableCredits, 500);

    const rows = await db.select().from(creditTransactions).where(eq(
      creditTransactions.idempotencyKey,
      idempotencyKey,
    ));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, fixture.customerId);

    const balance = await db.select().from(creditBalances).where(eq(
      creditBalances.userId,
      fixture.customerId,
    )).limit(1);
    assert.equal(balance[0]?.availableCredits, 500);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("admin credit grant is idempotent and does not double credit", async () => {
  const fixture = await createFixture();
  try {
    const idempotencyKey = `admin-grant-idem-${randomUUID()}`;
    const payload = {
      amount: 400,
      description: "Idempotent test",
      referenceId: "SUPPORT-002",
      idempotencyKey,
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/admin/credits/${fixture.customerId}/grant`,
      headers: { cookie: `${SESSION_COOKIE}=${fixture.adminToken}` },
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/admin/credits/${fixture.customerId}/grant`,
      headers: { cookie: `${SESSION_COOKIE}=${fixture.adminToken}` },
      payload,
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);

    const transactions = await db.select().from(creditTransactions).where(eq(
      creditTransactions.idempotencyKey,
      idempotencyKey,
    ));
    assert.equal(transactions.length, 1);

    const balance = await db.select().from(creditBalances).where(eq(
      creditBalances.userId,
      fixture.customerId,
    )).limit(1);
    assert.equal(balance[0]?.availableCredits, 400);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("admin cannot grant credits to a privileged account", async () => {
  const fixture = await createFixture();
  let privilegedId: string | undefined;
  try {
    const result = await db.insert(users).values({
      email: `privileged-target-${randomUUID()}@example.test`,
      displayName: "Privileged Target",
      role: "admin",
      status: "active",
      accountType: "individual",
    }).returning({ id: users.id });
    privilegedId = result[0]?.id;
    assert.ok(privilegedId);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/credits/${privilegedId}/grant`,
      headers: { cookie: `${SESSION_COOKIE}=${fixture.adminToken}` },
      payload: {
        amount: 100,
        idempotencyKey: `privileged-${randomUUID()}`,
      },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    if (privilegedId) {
      await db.delete(creditTransactions).where(eq(creditTransactions.userId, privilegedId));
      await db.delete(creditReservations).where(eq(creditReservations.userId, privilegedId));
      await db.delete(creditBalances).where(eq(creditBalances.userId, privilegedId));
      await db.delete(authSessions).where(eq(authSessions.userId, privilegedId));
      await db.delete(users).where(eq(users.id, privilegedId));
    }
    await cleanupFixture(fixture);
  }
});

test("admin credit detail returns 404 for unknown customer", async () => {
  const fixture = await createFixture();
  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/credits/${randomUUID()}`,
      headers: { cookie: `${SESSION_COOKIE}=${fixture.adminToken}` },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await cleanupFixture(fixture);
  }
});
