import test from "node:test";
import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import {
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
  usageRecords,
  users,
} from "@ak-vision-ai/database";

import {
  addCredits,
  consumeReservation,
  expireReservation,
  getOrCreateCreditBalance,
  releaseReservation,
  recordUsage,
  reserveCredits,
  settleReservation,
} from "./credits.repository.js";


test(
  "credit repository can create an individual credit balance",
  async () => {
    const email =
      `credit-test-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Repository Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    try {
      const balance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      assert.ok(balance);

      assert.equal(
        balance.userId,
        user.id,
      );

      assert.equal(
        balance.organizationId,
        null,
      );

      assert.equal(
        balance.availableCredits,
        0,
      );

      assert.equal(
        balance.reservedCredits,
        0,
      );

      assert.equal(
        balance.currency,
        "INR",
      );
    } finally {
      await db
        .delete(users)
        .where(
          eq(users.id, user.id),
        );
    }
  },
);
test(
  "credit repository safely handles concurrent getOrCreate calls for the same individual owner",
  async () => {
    const email =
      `credit-concurrency-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Concurrency Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    try {
      const results =
        await Promise.all(
          Array.from(
            { length: 10 },
            () =>
              getOrCreateCreditBalance({
                userId: user.id,
              }),
          ),
        );

      assert.equal(
        results.length,
        10,
      );

      const balanceIds =
        new Set(
          results.map(
            (balance) =>
              balance.id,
          ),
        );

      assert.equal(
        balanceIds.size,
        1,
      );

      for (const balance of results) {
        assert.equal(
          balance.userId,
          user.id,
        );

        assert.equal(
          balance.organizationId,
          null,
        );

        assert.equal(
          balance.availableCredits,
          0,
        );

        assert.equal(
          balance.reservedCredits,
          0,
        );

        assert.equal(
          balance.currency,
          "INR",
        );
      }

      const balances =
        await db
          .select()
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              user.id,
            ),
          );

      assert.equal(
        balances.length,
        1,
      );

      assert.equal(
        balances[0]?.id,
        results[0]?.id,
      );
    } finally {
      await db
        .delete(users)
        .where(
          eq(users.id, user.id),
        );
    }
  },
);
test(
  "credit repository returns the same individual balance on repeated getOrCreate calls",
  async () => {
    const email =
      `credit-idempotency-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Idempotency Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    try {
      const firstBalance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      const secondBalance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      assert.equal(
        firstBalance.id,
        secondBalance.id,
      );

      assert.equal(
        firstBalance.userId,
        secondBalance.userId,
      );

      assert.equal(
        secondBalance.availableCredits,
        0,
      );

      assert.equal(
        secondBalance.reservedCredits,
        0,
      );
    } finally {
      await db
        .delete(users)
        .where(eq(users.id, user.id));
    }
  },
);
test(
  "credit repository prevents double credit under concurrent duplicate addCredits calls",
  async () => {
    const email =
      `credit-add-concurrency-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Add Concurrency Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    const idempotencyKey =
      `credit-grant-${crypto.randomUUID()}`;

    try {
      const results =
        await Promise.all(
          Array.from(
            { length: 10 },
            () =>
              addCredits({
                userId: user.id,
                amount: 100,
                source: "purchase",
                idempotencyKey,
                description:
                  "Concurrent credit grant test",
              }),
          ),
        );

      assert.equal(
        results.length,
        10,
      );

      const transactionIds =
        new Set(
          results.map(
            (transaction) =>
              transaction.id,
          ),
        );

      assert.equal(
        transactionIds.size,
        1,
      );

      const balances =
        await db
          .select()
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              user.id,
            ),
          );

      assert.equal(
        balances.length,
        1,
      );

      const balance =
        balances[0];

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
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.idempotencyKey,
              idempotencyKey,
            ),
          );

      assert.equal(
        transactions.length,
        1,
      );

      assert.equal(
        transactions[0]?.amount,
        100,
      );

      assert.equal(
        transactions[0]?.type,
        "grant",
      );
    } finally {
  const cleanupBalances = await db
    .select({
      id: creditBalances.id,
    })
    .from(creditBalances)
    .where(
      eq(
        creditBalances.userId,
        user.id,
      ),
    );

  await db
  .delete(creditTransactions)
  .where(
    eq(
      creditTransactions.userId,
      user.id,
    ),
  );

for (const cleanupBalance of cleanupBalances) {
  await db
    .delete(creditTransactions)
    .where(
      eq(
        creditTransactions.creditBalanceId,
        cleanupBalance.id,
      ),
    );
}

  await db
    .delete(creditBalances)
    .where(
      eq(
        creditBalances.userId,
        user.id,
      ),
    );

  await db
    .delete(users)
    .where(
      eq(
        users.id,
        user.id,
      ),
    );
}
  },
);
test(
  "credit repository reserves available credits atomically",
  async () => {
    const email =
      `credit-reserve-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Reservation Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    const grantIdempotencyKey =
      `credit-reserve-grant-${crypto.randomUUID()}`;

    const reservationIdempotencyKey =
      `credit-reservation-${crypto.randomUUID()}`;

    try {
      await addCredits({
        userId: user.id,
        amount: 1000,
        source: "purchase",
        idempotencyKey:
          grantIdempotencyKey,
        description:
          "Reservation test funding",
      });

      const reservation =
        await reserveCredits({
          userId: user.id,
          amount: 300,
          idempotencyKey:
            reservationIdempotencyKey,
          referenceId:
            `reservation-test-${crypto.randomUUID()}`,
          expiresAt:
            new Date(
              Date.now() + 60 * 60 * 1000,
            ),
        });

      assert.ok(reservation);

      assert.equal(
        reservation.userId,
        user.id,
      );

      assert.equal(
        reservation.amount,
        300,
      );

      assert.equal(
        reservation.status,
        "reserved",
      );

      const balances =
        await db
          .select()
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              user.id,
            ),
          );

      const balance =
        balances[0];

      assert.ok(balance);

      assert.equal(
        balance.availableCredits,
        700,
      );

      assert.equal(
        balance.reservedCredits,
        300,
      );

      const transactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              reservation.id,
            ),
          );

      assert.equal(
        transactions.length,
        1,
      );

      assert.equal(
        transactions[0]?.type,
        "hold",
      );

      assert.equal(
        transactions[0]?.amount,
        300,
      );

      assert.equal(
        transactions[0]?.availableBalanceAfter,
        700,
      );

      assert.equal(
        transactions[0]?.reservedBalanceAfter,
        300,
      );
    } finally {
      const cleanupBalances =
        await db
          .select({
            id: creditBalances.id,
          })
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              user.id,
            ),
          );

      for (const cleanupBalance of cleanupBalances) {
        await db
          .delete(creditTransactions)
          .where(
            eq(
              creditTransactions.creditBalanceId,
              cleanupBalance.id,
            ),
          );
      }

      await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            user.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);
test(
  "credit repository consumes a reservation atomically",
  async () => {
    const email =
      `credit-consume-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Consume Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    try {
      await addCredits({
        userId: user.id,
        amount: 100,
        source: "purchase",
        idempotencyKey:
          `credit-consume-grant-${crypto.randomUUID()}`,
        description:
          "Credit consume test grant",
      });

      const reservation =
        await reserveCredits({
          userId: user.id,
          amount: 40,
          idempotencyKey:
            `credit-consume-reserve-${crypto.randomUUID()}`,
          expiresAt:
            new Date(
              Date.now() + 60 * 60 * 1000,
            ),
        });

      assert.equal(
        reservation.status,
        "reserved",
      );

      const consumed =
        await consumeReservation(
          reservation.id,
          `consume-${crypto.randomUUID()}`,
          {
            userId: user.id,
          },
        );

      assert.equal(
        consumed.id,
        reservation.id,
      );

      assert.equal(
        consumed.status,
        "consumed",
      );

      assert.ok(
        consumed.consumedAt,
      );

      const balances =
        await db
          .select()
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              user.id,
            ),
          );

      const balance =
        balances[0];

      assert.ok(balance);

      assert.equal(
        balance.availableCredits,
        60,
      );

      assert.equal(
        balance.reservedCredits,
        0,
      );

      const transactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.userId,
              user.id,
            ),
          );

      const consumeTransactions =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "consume",
        );

      assert.equal(
        consumeTransactions.length,
        1,
      );

      assert.equal(
        consumeTransactions[0]?.amount,
        40,
      );
    } finally {
      const cleanupBalances =
        await db
          .select({
            id: creditBalances.id,
          })
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              user.id,
            ),
          );

      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            user.id,
          ),
        );

      for (
        const cleanupBalance of
          cleanupBalances
      ) {
        await db
          .delete(creditTransactions)
          .where(
            eq(
              creditTransactions.creditBalanceId,
              cleanupBalance.id,
            ),
          );
      }
            await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            user.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);
test(
  "credit repository settles a reservation and records usage atomically",
  async () => {
    const email =
      `credit-settle-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Settlement Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    const balance =
      await getOrCreateCreditBalance({
        userId: user.id,
      });

    await addCredits({
      userId: user.id,
      amount: 100,
      source: "free",
      referenceId:
        `settle-grant-${crypto.randomUUID()}`,
      idempotencyKey:
        `settle-grant-${crypto.randomUUID()}`,
      description:
        "Settlement test credits",
    });

    const reservation =
      await reserveCredits({
        userId: user.id,
        amount: 60,
        referenceId:
          `settle-reservation-${crypto.randomUUID()}`,
        idempotencyKey:
          `settle-reservation-${crypto.randomUUID()}`,
        expiresAt:
          new Date(
            Date.now() + 60_000,
          ),
      });

    const requestId =
    crypto.randomUUID();

    try {
      const result =
        await settleReservation(
          {
            reservationId:
              reservation.id,
            referenceId:
              `settle-reference-${crypto.randomUUID()}`,
            usage: {
              requestId,
              providerId:
                "test-provider",
              providerModelId:
                "test-model",
              creditsUsed: 40,
              providerCostMinor: 100,
              infrastructureCostMinor: 20,
              retryCostMinor: 0,
              customerChargeMinor: 200,
              platformContributionMinor: 80,
              currency: "INR",
            },
          },
          {
            userId: user.id,
          },
        );

      assert.ok(
        result.reservation,
      );

      assert.ok(result.usage);

      assert.equal(
        result.reservation.status,
        "consumed",
      );

      assert.equal(
        result.usage.requestId,
        requestId,
      );

      assert.equal(
        result.usage.creditsUsed,
        40,
      );

      const finalBalance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      assert.equal(
        finalBalance.availableCredits,
        60,
      );

      assert.equal(
        finalBalance.reservedCredits,
        0,
      );

      const usageRows =
  await db
    .select()
    .from(usageRecords)
    .where(
      eq(
        usageRecords.requestId,
        requestId,
      ),
    );

      assert.equal(
  usageRows.length,
  1,
);

      const settlementTransactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              reservation.id,
            ),
          );

      const consumeTransactions =
        settlementTransactions.filter(
          (transaction) =>
            transaction.type ===
            "consume",
        );

      assert.equal(
        consumeTransactions.length,
        1,
      );

      assert.equal(
        consumeTransactions[0]?.amount,
        40,
      );
    } finally {
      const cleanupBalances =
        await db
          .select({
            id: creditBalances.id,
          })
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              user.id,
            ),
          );

      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            user.id,
          ),
        );

      await db
        .delete(usageRecords)
        .where(
          eq(
            usageRecords.userId,
            user.id,
          ),
        );

      await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            user.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);

test(
  "credit repository releases a reservation and restores available credits atomically",
  async () => {
    const email =
      `credit-release-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Release Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    try {
      await addCredits({
        userId: user.id,
        amount: 100,
        source: "free",
        idempotencyKey:
          `release-grant-${crypto.randomUUID()}`,
        description:
          "Release reservation test credits",
      });

      const reservation =
        await reserveCredits({
          userId: user.id,
          amount: 40,
          referenceId:
            `release-reservation-${crypto.randomUUID()}`,
          idempotencyKey:
            `release-reservation-${crypto.randomUUID()}`,
          expiresAt:
            new Date(
              Date.now() + 60 * 60 * 1000,
            ),
        });

      assert.equal(
        reservation.status,
        "reserved",
      );

      const released =
        await releaseReservation(
          reservation.id,
          `release-reference-${crypto.randomUUID()}`,
        );

      assert.equal(
        released.id,
        reservation.id,
      );

      assert.equal(
        released.status,
        "released",
      );

      assert.ok(
        released.releasedAt,
      );

      const finalBalance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      assert.equal(
        finalBalance.availableCredits,
        100,
      );

      assert.equal(
        finalBalance.reservedCredits,
        0,
      );

      const transactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              reservation.id,
            ),
          );

      const releaseTransactions =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "release",
        );

      assert.equal(
        releaseTransactions.length,
        1,
      );

      assert.equal(
        releaseTransactions[0]?.amount,
        40,
      );

      assert.equal(
        releaseTransactions[0]?.availableBalanceAfter,
        100,
      );

      assert.equal(
        releaseTransactions[0]?.reservedBalanceAfter,
        0,
      );
    } finally {
      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            user.id,
          ),
        );

      await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            user.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);

test(
  "credit repository expires an expired reservation and restores available credits atomically",
  async () => {
    const email =
      `credit-expire-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Expire Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    try {
      await addCredits({
        userId: user.id,
        amount: 100,
        source: "free",
        idempotencyKey:
          `expire-grant-${crypto.randomUUID()}`,
        description:
          "Expire reservation test credits",
      });

      const reservation =
        await reserveCredits({
          userId: user.id,
          amount: 40,
          referenceId:
            `expire-reservation-${crypto.randomUUID()}`,
          idempotencyKey:
            `expire-reservation-${crypto.randomUUID()}`,
          expiresAt:
            new Date(
              Date.now() - 60 * 1000,
            ),
        });

      assert.equal(
        reservation.status,
        "reserved",
      );

      const expired =
        await expireReservation(
          reservation.id,
          `expire-reference-${crypto.randomUUID()}`,
        );

      assert.equal(
        expired.id,
        reservation.id,
      );

      assert.equal(
        expired.status,
        "expired",
      );

      assert.ok(
        expired.releasedAt,
      );

      const finalBalance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      assert.equal(
        finalBalance.availableCredits,
        100,
      );

      assert.equal(
        finalBalance.reservedCredits,
        0,
      );

      const transactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              reservation.id,
            ),
          );

      const releaseTransactions =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "release",
        );

      assert.equal(
        releaseTransactions.length,
        1,
      );

      assert.equal(
        releaseTransactions[0]?.amount,
        40,
      );

      assert.equal(
        releaseTransactions[0]?.availableBalanceAfter,
        100,
      );

      assert.equal(
        releaseTransactions[0]?.reservedBalanceAfter,
        0,
      );
    } finally {
      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            user.id,
          ),
        );

      await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            user.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);

test(
  "credit repository settles the same usage request idempotently",
  async () => {
    const email =
      `credit-settle-idempotent-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Settlement Idempotency Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    try {
      await addCredits({
        userId: user.id,
        amount: 100,
        source: "free",
        idempotencyKey:
          `settle-idempotent-grant-${crypto.randomUUID()}`,
        description:
          "Settlement idempotency test credits",
      });

      const reservation =
        await reserveCredits({
          userId: user.id,
          amount: 60,
          referenceId:
            `settle-idempotent-reservation-${crypto.randomUUID()}`,
          idempotencyKey:
            `settle-idempotent-reservation-${crypto.randomUUID()}`,
          expiresAt:
            new Date(
              Date.now() + 60 * 60 * 1000,
            ),
        });

      const requestId =
        crypto.randomUUID();

      const usage = {
        requestId,
        providerId:
          "test-provider",
        providerModelId:
          "test-model",
        creditsUsed: 40,
        providerCostMinor: 100,
        infrastructureCostMinor: 20,
        retryCostMinor: 0,
        customerChargeMinor: 200,
        platformContributionMinor: 80,
        currency: "INR",
      };

      const first =
        await settleReservation(
          {
            reservationId:
              reservation.id,
            referenceId:
              `settle-idempotent-reference-${crypto.randomUUID()}`,
            usage,
          },
          {
            userId: user.id,
          },
        );

      const second =
        await settleReservation(
          {
            reservationId:
              reservation.id,
            referenceId:
              `settle-idempotent-reference-retry-${crypto.randomUUID()}`,
            usage,
          },
          {
            userId: user.id,
          },
        );

      assert.ok(first.reservation);
      assert.ok(first.usage);
      assert.equal(
        first.reservation.status,
        "consumed",
      );

      assert.equal(
        first.usage.id,
        second.usage.id,
      );

      assert.equal(
        first.usage.reservationId,
        reservation.id,
      );

      assert.equal(
        second.usage.reservationId,
        reservation.id,
      );

      assert.equal(
        second.reservation,
        null,
      );

      const finalBalance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      assert.equal(
        finalBalance.availableCredits,
        60,
      );

      assert.equal(
        finalBalance.reservedCredits,
        0,
      );

      const usageRows =
        await db
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              requestId,
            ),
          );

      assert.equal(
        usageRows.length,
        1,
      );

      const transactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              reservation.id,
            ),
          );

      const consumeTransactions =
        transactions.filter(
          (transaction) =>
            transaction.type ===
            "consume",
        );

      assert.equal(
        consumeTransactions.length,
        1,
      );

      assert.equal(
        consumeTransactions[0]?.amount,
        40,
      );
    } finally {
      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            user.id,
          ),
        );

      await db
        .delete(usageRecords)
        .where(
          eq(
            usageRecords.userId,
            user.id,
          ),
        );

      await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            user.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);

test(
  "credit repository prevents settling a reservation owned by another user",
  async () => {
    const ownerEmail =
      `credit-owner-${crypto.randomUUID()}@example.test`;

    const attackerEmail =
      `credit-attacker-${crypto.randomUUID()}@example.test`;

    const ownerResult = await db
      .insert(users)
      .values({
        email: ownerEmail,
        displayName:
          "Credit Reservation Owner Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const attackerResult = await db
      .insert(users)
      .values({
        email: attackerEmail,
        displayName:
          "Credit Reservation Attacker Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const owner = ownerResult[0];
    const attacker = attackerResult[0];

    assert.ok(owner);
    assert.ok(attacker);

    try {
      await addCredits({
        userId: owner.id,
        amount: 100,
        source: "free",
        idempotencyKey:
          `owner-grant-${crypto.randomUUID()}`,
        description:
          "Owner isolation test credits",
      });

      const reservation =
        await reserveCredits({
          userId: owner.id,
          amount: 60,
          referenceId:
            `owner-reservation-${crypto.randomUUID()}`,
          idempotencyKey:
            `owner-reservation-${crypto.randomUUID()}`,
          expiresAt:
            new Date(
              Date.now() + 60 * 60 * 1000,
            ),
        });

      const requestId =
        crypto.randomUUID();

      await assert.rejects(
        () =>
          settleReservation(
            {
              reservationId:
                reservation.id,
              referenceId:
                `attacker-settlement-${crypto.randomUUID()}`,
              usage: {
                requestId,
                providerId:
                  "test-provider",
                providerModelId:
                  "test-model",
                creditsUsed: 60,
                providerCostMinor: 100,
                infrastructureCostMinor: 20,
                retryCostMinor: 0,
                customerChargeMinor: 200,
                platformContributionMinor: 80,
                currency: "INR",
              },
            },
            {
              userId: attacker.id,
            },
          ),
        (error: unknown) => {
          assert.ok(
            error instanceof Error,
          );

          assert.equal(
            (error as {
              code?: string;
            }).code,
            "IDEMPOTENCY_CONFLICT",
          );

          return true;
        },
      );

      const ownerBalance =
        await getOrCreateCreditBalance({
          userId: owner.id,
        });

      assert.equal(
        ownerBalance.availableCredits,
        40,
      );

      assert.equal(
        ownerBalance.reservedCredits,
        60,
      );

      const reservations =
        await db
          .select()
          .from(creditReservations)
          .where(
            eq(
              creditReservations.id,
              reservation.id,
            ),
          );

      assert.equal(
        reservations.length,
        1,
      );

      assert.equal(
        reservations[0]?.status,
        "reserved",
      );

      const usageRows =
        await db
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              requestId,
            ),
          );

      assert.equal(
        usageRows.length,
        0,
      );

      const reservationTransactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              reservation.id,
            ),
          );

      const consumeTransactions =
        reservationTransactions.filter(
          (transaction) =>
            transaction.type ===
            "consume",
        );

      assert.equal(
        consumeTransactions.length,
        0,
      );
    } finally {
      const ownerBalances =
        await db
          .select({
            id: creditBalances.id,
          })
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              owner.id,
            ),
          );

      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            owner.id,
          ),
        );

      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            attacker.id,
          ),
        );

      await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            owner.id,
          ),
        );


      for (const balance of ownerBalances) {
        await db
          .delete(creditTransactions)
          .where(
            eq(
              creditTransactions.creditBalanceId,
              balance.id,
            ),
          );
      }

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            owner.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            attacker.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            owner.id,
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
    }
  },
);

test(
  "credit repository prevents double settlement under concurrent settlement calls",
  async () => {
    const email =
      `credit-settle-concurrency-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Settlement Concurrency Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    let reservationId: string | undefined;
    const requestId =
      crypto.randomUUID();

    try {
      await addCredits({
        userId: user.id,
        amount: 100,
        source: "free",
        idempotencyKey:
          `settle-concurrency-grant-${crypto.randomUUID()}`,
        description:
          "Concurrent settlement test credits",
      });

      const reservation =
        await reserveCredits({
          userId: user.id,
          amount: 60,
          referenceId:
            `settle-concurrency-reservation-${crypto.randomUUID()}`,
          idempotencyKey:
            `settle-concurrency-reservation-${crypto.randomUUID()}`,
          expiresAt:
            new Date(
              Date.now() + 60 * 60 * 1000,
            ),
        });

      reservationId =
        reservation.id;

      const usage = {
        requestId,
        providerId:
          "test-provider",
        providerModelId:
          "test-model",
        creditsUsed: 40,
        providerCostMinor: 100,
        infrastructureCostMinor: 20,
        retryCostMinor: 0,
        customerChargeMinor: 200,
        platformContributionMinor: 80,
        currency: "INR",
      } as const;

      const results =
        await Promise.allSettled([
          settleReservation(
            {
              reservationId:
                reservation.id,
              referenceId:
                `concurrent-settlement-a-${crypto.randomUUID()}`,
              usage,
            },
            {
              userId: user.id,
            },
          ),
          settleReservation(
            {
              reservationId:
                reservation.id,
              referenceId:
                `concurrent-settlement-b-${crypto.randomUUID()}`,
              usage,
            },
            {
              userId: user.id,
            },
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
        2,
      );

      assert.equal(
        rejected.length,
        0,
      );

      const finalBalance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      assert.equal(
        finalBalance.availableCredits,
        60,
      );

      assert.equal(
        finalBalance.reservedCredits,
        0,
      );

      const reservations =
        await db
          .select()
          .from(creditReservations)
          .where(
            eq(
              creditReservations.id,
              reservation.id,
            ),
          );

      assert.equal(
        reservations.length,
        1,
      );

      assert.equal(
        reservations[0]?.status,
        "consumed",
      );

      const usageRows =
        await db
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              requestId,
            ),
          );

      assert.equal(
        usageRows.length,
        1,
      );

      assert.equal(
        usageRows[0]?.creditsUsed,
        40,
      );

      const settlementTransactions =
        await db
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              reservation.id,
            ),
          );

      const consumeTransactions =
        settlementTransactions.filter(
          (transaction) =>
            transaction.type ===
            "consume",
        );

      assert.equal(
        consumeTransactions.length,
        1,
      );

      assert.equal(
        consumeTransactions[0]?.amount,
        40,
      );
    } finally {
      await db
        .delete(usageRecords)
        .where(
          eq(
            usageRecords.requestId,
            requestId,
          ),
        );

      if (reservationId) {
        await db
          .delete(creditTransactions)
          .where(
            eq(
              creditTransactions.reservationId,
              reservationId,
            ),
          );

        await db
          .delete(creditReservations)
          .where(
            eq(
              creditReservations.id,
              reservationId,
            ),
          );
      }

      const balances =
        await db
          .select({
            id: creditBalances.id,
          })
          .from(creditBalances)
          .where(
            eq(
              creditBalances.userId,
              user.id,
            ),
          );

      for (const balance of balances) {
        await db
          .delete(creditTransactions)
          .where(
            eq(
              creditTransactions.creditBalanceId,
              balance.id,
            ),
          );
      }

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);

test(
  "credit repository records trusted usage successfully",
  async () => {
    const email =
      `credit-usage-${crypto.randomUUID()}@example.test`;

    const userResult =
      await db
        .insert(users)
        .values({
          email,
          displayName:
            "Credit Usage Test User",
          role: "customer",
          status: "active",
          accountType: "individual",
        })
        .returning({
          id: users.id,
        });

    const user = userResult[0];

    assert.ok(user);

    const requestId =
      crypto.randomUUID();

    try {
      const usage =
        await recordUsage(
          {
            requestId,
            providerId:
              "test-provider",
            providerModelId:
              "test-model",
            creditsUsed: 25,
            providerCostMinor: 100,
            infrastructureCostMinor: 20,
            retryCostMinor: 5,
            customerChargeMinor: 200,
            platformContributionMinor: 75,
            currency: "INR",
          },
          {
            userId: user.id,
          },
        );

      assert.ok(usage);

      assert.equal(
        usage.requestId,
        requestId,
      );

      assert.equal(
        usage.userId,
        user.id,
      );

      assert.equal(
        usage.organizationId,
        null,
      );

      assert.equal(
        usage.providerId,
        "test-provider",
      );

      assert.equal(
        usage.providerModelId,
        "test-model",
      );

      assert.equal(
        usage.creditsUsed,
        25,
      );

      assert.equal(
        usage.providerCostMinor,
        100,
      );

      assert.equal(
        usage.infrastructureCostMinor,
        20,
      );

      assert.equal(
        usage.retryCostMinor,
        5,
      );

      assert.equal(
        usage.customerChargeMinor,
        200,
      );

      assert.equal(
        usage.platformContributionMinor,
        75,
      );

      assert.equal(
        usage.currency,
        "INR",
      );

      const usageRows =
        await db
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              requestId,
            ),
          );

      assert.equal(
        usageRows.length,
        1,
      );

      assert.equal(
        usageRows[0]?.id,
        usage.id,
      );
    } finally {
      await db
        .delete(usageRecords)
        .where(
          eq(
            usageRecords.requestId,
            requestId,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);

test(
  "credit repository enforces recordUsage request idempotency and owner isolation",
  async () => {
    const emailA =
      `credit-usage-owner-a-${crypto.randomUUID()}@example.test`;

    const emailB =
      `credit-usage-owner-b-${crypto.randomUUID()}@example.test`;

    const usersResult =
      await db
        .insert(users)
        .values([
          {
            email: emailA,
            displayName:
              "Usage Idempotency Owner A",
            role: "customer",
            status: "active",
            accountType: "individual",
          },
          {
            email: emailB,
            displayName:
              "Usage Idempotency Owner B",
            role: "customer",
            status: "active",
            accountType: "individual",
          },
        ])
        .returning({
          id: users.id,
        });

    const userA = usersResult[0];
    const userB = usersResult[1];

    assert.ok(userA);
    assert.ok(userB);

    const requestId =
      crypto.randomUUID();

    try {
      const first =
        await recordUsage(
          {
            requestId,
            providerId:
              "test-provider",
            providerModelId:
              "test-model",
            creditsUsed: 30,
            providerCostMinor: 120,
            infrastructureCostMinor: 25,
            retryCostMinor: 5,
            customerChargeMinor: 250,
            platformContributionMinor: 100,
            currency: "INR",
          },
          {
            userId: userA.id,
          },
        );

      const second =
        await recordUsage(
          {
            requestId,
            providerId:
              "test-provider",
            providerModelId:
              "test-model",
            creditsUsed: 30,
            providerCostMinor: 120,
            infrastructureCostMinor: 25,
            retryCostMinor: 5,
            customerChargeMinor: 250,
            platformContributionMinor: 100,
            currency: "INR",
          },
          {
            userId: userA.id,
          },
        );

      assert.equal(
        second.id,
        first.id,
      );

      const usageRows =
        await db
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              requestId,
            ),
          );

      assert.equal(
        usageRows.length,
        1,
      );

      await assert.rejects(
        () =>
          recordUsage(
            {
              requestId,
              providerId:
                "test-provider",
              providerModelId:
                "test-model",
              creditsUsed: 30,
              providerCostMinor: 120,
              infrastructureCostMinor: 25,
              retryCostMinor: 5,
              customerChargeMinor: 250,
              platformContributionMinor: 100,
              currency: "INR",
            },
            {
              userId: userB.id,
            },
          ),
        (error: unknown) => {
          assert.ok(
            error instanceof Error,
          );

          assert.equal(
            (
              error as {
                code?: string;
              }
            ).code,
            "IDEMPOTENCY_CONFLICT",
          );

          return true;
        },
      );
    } finally {
      await db
        .delete(usageRecords)
        .where(
          eq(
            usageRecords.requestId,
            requestId,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            userA.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            userB.id,
          ),
        );
    }
  },
);

test(
  "credit repository prevents duplicate usage records under concurrent recordUsage calls",
  async () => {
    const email =
      `credit-usage-concurrent-${crypto.randomUUID()}@example.test`;

    const userResult =
      await db
        .insert(users)
        .values({
          email,
          displayName:
            "Concurrent Usage Test User",
          role: "customer",
          status: "active",
          accountType: "individual",
        })
        .returning({
          id: users.id,
        });

    const user = userResult[0];

    assert.ok(user);

    const requestId =
      crypto.randomUUID();

    try {
      const results =
        await Promise.all(
          Array.from(
            { length: 10 },
            () =>
              recordUsage(
                {
                  requestId,
                  providerId:
                    "test-provider",
                  providerModelId:
                    "test-model",
                  creditsUsed: 25,
                  providerCostMinor: 100,
                  infrastructureCostMinor: 20,
                  retryCostMinor: 5,
                  customerChargeMinor: 200,
                  platformContributionMinor: 75,
                  currency: "INR",
                },
                {
                  userId: user.id,
                },
              ),
          ),
        );

      assert.equal(
        results.length,
        10,
      );

      const usageIds =
        new Set(
          results.map(
            (usage) =>
              usage.id,
          ),
        );

      assert.equal(
        usageIds.size,
        1,
      );

      for (const usage of results) {
        assert.equal(
          usage.requestId,
          requestId,
        );

        assert.equal(
          usage.userId,
          user.id,
        );

        assert.equal(
          usage.creditsUsed,
          25,
        );
      }

      const usageRows =
        await db
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              requestId,
            ),
          );

      assert.equal(
        usageRows.length,
        1,
      );

      assert.equal(
        usageRows[0]?.id,
        results[0]?.id,
      );
    } finally {
      await db
        .delete(usageRecords)
        .where(
          eq(
            usageRecords.requestId,
            requestId,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);

test(
  "credit repository rejects settlement when usage exceeds reserved credits",
  async () => {
    const email =
      `credit-settle-overage-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Credit Settlement Overage Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    await getOrCreateCreditBalance({
      userId: user.id,
    });

    await addCredits({
      userId: user.id,
      amount: 100,
      source: "free",
      referenceId:
        `overage-grant-${crypto.randomUUID()}`,
      idempotencyKey:
        `overage-grant-${crypto.randomUUID()}`,
      description:
        "Settlement overage test credits",
    });

    const reservation =
      await reserveCredits({
        userId: user.id,
        amount: 60,
        referenceId:
          `overage-reservation-${crypto.randomUUID()}`,
        idempotencyKey:
          `overage-reservation-${crypto.randomUUID()}`,
        expiresAt:
          new Date(
            Date.now() + 60_000,
          ),
      });

    try {
      await assert.rejects(
        () =>
          settleReservation(
            {
              reservationId:
                reservation.id,
              referenceId:
                `overage-settlement-${crypto.randomUUID()}`,
              usage: {
                requestId:
                  crypto.randomUUID(),
                providerId:
                  "test-provider",
                providerModelId:
                  "test-model",
                creditsUsed: 61,
                providerCostMinor: 100,
                infrastructureCostMinor: 20,
                retryCostMinor: 0,
                customerChargeMinor: 200,
                platformContributionMinor: 80,
                currency: "INR",
              },
            },
            {
              userId: user.id,
            },
          ),
        (error: unknown) => {
          assert.ok(
            error instanceof Error,
          );

          assert.equal(
            (error as {
              code?: string;
            }).code,
            "INVALID_AMOUNT",
          );

          return true;
        },
      );

      const finalBalance =
        await getOrCreateCreditBalance({
          userId: user.id,
        });

      assert.equal(
        finalBalance.availableCredits,
        40,
      );

      assert.equal(
        finalBalance.reservedCredits,
        60,
      );
    } finally {
      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            user.id,
          ),
        );

      await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            user.id,
          ),
        );

      await db
        .delete(usageRecords)
        .where(
          eq(
            usageRecords.userId,
            user.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            user.id,
          ),
        );
    }
  },
);

test(
  "credit repository rejects settling an already consumed reservation",
  async () => {
    const email =
      `credit-settle-consumed-${crypto.randomUUID()}@example.test`;

    const userResult = await db
      .insert(users)
      .values({
        email,
        displayName:
          "Consumed Reservation Test User",
        role: "customer",
        status: "active",
        accountType: "individual",
      })
      .returning({
        id: users.id,
      });

    const user = userResult[0];

    assert.ok(user);

    try {
      await addCredits({
        userId: user.id,
        amount: 100,
        idempotencyKey:
          `settle-consumed-add-${crypto.randomUUID()}`,
        source: "free",
        description:
          "Consumed reservation state test",
      });

      const reservation =
        await reserveCredits({
          userId: user.id,
          amount: 40,
          referenceId:
            `settle-consumed-reservation-${crypto.randomUUID()}`,
          idempotencyKey:
            `settle-consumed-reservation-idem-${crypto.randomUUID()}`,
        });

      assert.ok(reservation);

      await consumeReservation(
        reservation.id,
        undefined,
        {
          userId: user.id,
        },
      );

      await assert.rejects(
        () =>
                              settleReservation(
            {
              reservationId:
                reservation.id,
              referenceId:
                `settle-consumed-settlement-${crypto.randomUUID()}`,
              usage: {
                requestId:
                  `settle-consumed-usage-${crypto.randomUUID()}`,
                providerId:
                  "test-provider",
                providerModelId:
                  "test-model",
                creditsUsed: 40,
                currency: "INR",
              },
            },
            {
              userId: user.id,
            },
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error);

          assert.match(
            error.message,
            /status|consumed|settle/i,
          );

          return true;
        },
      );
        } finally {
      await db
        .delete(creditTransactions)
        .where(
          eq(
            creditTransactions.userId,
            user.id,
          ),
        );

      await db
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.userId,
            user.id,
          ),
        );

      await db
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            user.id,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(users.id, user.id),
        );
    }
  },
);




