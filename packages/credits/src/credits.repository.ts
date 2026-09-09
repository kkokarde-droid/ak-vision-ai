import {
  and,
  eq,
  isNull,
  sql,
} from "drizzle-orm";

import {
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
  usageRecords,
} from "@ak-vision-ai/database";

import type {
  AddCreditsInput,
  CreateCreditReservationInput,
  RecordUsageSettlementInput,
} from "./credits.types.js";

export class CreditRepositoryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_OWNER"
      | "NOT_FOUND"
      | "INSUFFICIENT_CREDITS"
      | "INVALID_STATE"
      | "IDEMPOTENCY_CONFLICT"
      | "INVALID_AMOUNT"
      | "INVALID_INPUT",
  ) {
    super(message);
    this.name = "CreditRepositoryError";
  }
}

type OwnerInput = {
  userId?: string;
  organizationId?: string;
};

function assertExactlyOneOwner(
  owner: OwnerInput,
): void {
  const hasUser = Boolean(owner.userId);
  const hasOrganization =
    Boolean(owner.organizationId);

  if (hasUser === hasOrganization) {
    throw new CreditRepositoryError(
      "Exactly one of userId or organizationId is required",
      "INVALID_OWNER",
    );
  }
}

function ownerMatches(
  record: {
    userId: string | null;
    organizationId: string | null;
  },
  owner: OwnerInput,
): boolean {
  return (
    record.userId === (owner.userId ?? null) &&
    record.organizationId ===
      (owner.organizationId ?? null)
  );
}

function ownerWhere(
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  if (owner.userId) {
    return and(
      eq(
        creditBalances.userId,
        owner.userId,
      ),
      isNull(
        creditBalances.organizationId,
      ),
    );
  }

  if (owner.organizationId) {
    return and(
      eq(
        creditBalances.organizationId,
        owner.organizationId,
      ),
      isNull(
        creditBalances.userId,
      ),
    );
  }

  throw new CreditRepositoryError(
    "Exactly one of userId or organizationId is required",
    "INVALID_OWNER",
  );
}

async function getOrCreateBalanceTx(
  tx: any,
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  const existing = await tx
    .select()
    .from(creditBalances)
    .where(ownerWhere(owner))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  await tx
    .insert(creditBalances)
    .values({
      userId: owner.userId ?? null,
      organizationId:
        owner.organizationId ?? null,
      availableCredits: 0,
      reservedCredits: 0,
      currency: "INR",
    })
    .onConflictDoNothing();

  const createdOrExisting = await tx
    .select()
    .from(creditBalances)
    .where(ownerWhere(owner))
    .limit(1);

  const balance =
    createdOrExisting[0];

  if (!balance) {
    throw new CreditRepositoryError(
      "Unable to create or load credit balance",
      "NOT_FOUND",
    );
  }

  return balance;
}

async function getLockedBalanceTx(
  tx: any,
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  const result = await tx
    .select()
    .from(creditBalances)
    .where(ownerWhere(owner))
    .for("update")
    .limit(1);

  return result[0] ?? null;
}

async function getLockedBalanceByIdTx(
  tx: any,
  balanceId: string,
) {
  const result = await tx
    .select()
    .from(creditBalances)
    .where(
      eq(
        creditBalances.id,
        balanceId,
      ),
    )
    .for("update")
    .limit(1);

  return result[0] ?? null;
}

function assertPositiveAmount(
  amount: number,
) {
  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    throw new CreditRepositoryError(
      "Credit amount must be a positive integer",
      "INVALID_AMOUNT",
    );
  }
}

/**
 * Load a credit balance without mutating it.
 */
export async function getCreditBalance(
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  const result = await db
    .select()
    .from(creditBalances)
    .where(ownerWhere(owner))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Create the owner's credit balance if it does not exist.
 *
 * Safe under concurrent calls because the owner has a
 * database-level partial unique index.
 */
/**
 * Create/load a credit balance inside an existing transaction.
 *
 * This is the transaction-aware boundary for callers that
 * must atomically provision an account with another mutation,
 * such as user registration.
 */
export async function getOrCreateCreditBalanceTx(
  tx: any,
  owner: {
    userId?: string;
    organizationId?: string;
  },
) {
  assertExactlyOneOwner(owner);

  return getOrCreateBalanceTx(
    tx,
    owner,
  );
}
export async function getOrCreateCreditBalance(
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  return db.transaction(
    async (tx) => {
      return getOrCreateBalanceTx(
        tx,
        owner,
      );
    },
  );
}

/**
 * Add credits to an account.
 *
 * This is a trusted/internal operation.
 */
export async function addCredits(
  input: AddCreditsInput,
) {
  assertExactlyOneOwner(input);
  assertPositiveAmount(input.amount);

  return db.transaction(
    async (tx) => {
      const existing =
        await tx
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.idempotencyKey,
              input.idempotencyKey,
            ),
          )
          .limit(1);

      if (existing[0]) {
        if (
          !ownerMatches(
            existing[0],
            input,
          ) ||
          existing[0].amount !==
            input.amount ||
          existing[0].source !==
            input.source
        ) {
          throw new CreditRepositoryError(
            "Idempotency key was already used for a different credit operation",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        return existing[0];
      }

      let balance =
        await getLockedBalanceTx(
          tx,
          input,
        );

      if (!balance) {
        await getOrCreateBalanceTx(
          tx,
          input,
        );

        balance =
          await getLockedBalanceTx(
            tx,
            input,
          );
      }

      if (!balance) {
        throw new CreditRepositoryError(
          "Credit balance not found",
          "NOT_FOUND",
        );
      }
            const lockedExisting =
        await tx
          .select()
          .from(creditTransactions)
          .where(
            eq(
              creditTransactions.idempotencyKey,
              input.idempotencyKey,
            ),
          )
          .limit(1);

      if (lockedExisting[0]) {
        if (
          !ownerMatches(
            lockedExisting[0],
            input,
          ) ||
          lockedExisting[0].amount !==
            input.amount ||
          lockedExisting[0].source !==
            input.source
        ) {
          throw new CreditRepositoryError(
            "Idempotency key was already used for a different credit operation",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        return lockedExisting[0];
      }
      const availableAfter =
        balance.availableCredits +
        input.amount;

      const updated =
        await tx
          .update(creditBalances)
          .set({
            availableCredits:
              availableAfter,
            updatedAt: new Date(),
          })
          .where(
            eq(
              creditBalances.id,
              balance.id,
            ),
          )
          .returning();

      const nextBalance =
        updated[0];

      if (!nextBalance) {
        throw new CreditRepositoryError(
          "Credit balance update failed",
          "NOT_FOUND",
        );
      }

      const ledger =
        await tx
          .insert(creditTransactions)
          .values({
            creditBalanceId:
              balance.id,
            reservationId: null,
            userId:
              balance.userId,
            organizationId:
              balance.organizationId,
            type: "grant",
            source: input.source,
            amount: input.amount,
            availableBalanceAfter:
              nextBalance.availableCredits,
            reservedBalanceAfter:
              nextBalance.reservedCredits,
            referenceId:
              input.referenceId,
            idempotencyKey:
              input.idempotencyKey,
            description:
              input.description,
          })
          .returning();

      const transaction =
        ledger[0];

      if (!transaction) {
        throw new CreditRepositoryError(
          "Credit ledger insert failed",
          "NOT_FOUND",
        );
      }

      return transaction;
    },
  );
}

/**
 * Reserve credits atomically.
 *
 * Balance row is locked before the available/reserved
 * counters are changed.
 */


/**
 * Reserve credits inside an existing transaction.
 *
 * The caller owns transaction boundaries.
 */
export async function reserveCreditsTx(
  tx: CreditTransaction,
  input: CreateCreditReservationInput,
) {
  assertExactlyOneOwner(input);
  assertPositiveAmount(input.amount);


      const existing =
        await tx
          .select()
          .from(creditReservations)
          .where(
            eq(
              creditReservations.idempotencyKey,
              input.idempotencyKey,
            ),
          )
          .limit(1);

      if (existing[0]) {
        if (
          !ownerMatches(
            existing[0],
            input,
          ) ||
          existing[0].amount !==
            input.amount
        ) {
          throw new CreditRepositoryError(
            "Idempotency key was already used for a different reservation",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        return existing[0];
      }

      let balance =
        await getLockedBalanceTx(
          tx,
          input,
        );

      if (!balance) {
        await getOrCreateBalanceTx(
          tx,
          input,
        );

        balance =
          await getLockedBalanceTx(
            tx,
            input,
          );
      }

      if (!balance) {
        throw new CreditRepositoryError(
          "Credit balance not found",
          "NOT_FOUND",
        );
      }

      if (
        balance.availableCredits <
        input.amount
      ) {
        throw new CreditRepositoryError(
          "Insufficient available credits",
          "INSUFFICIENT_CREDITS",
        );
      }

      const availableAfter =
        balance.availableCredits -
        input.amount;

      const reservedAfter =
        balance.reservedCredits +
        input.amount;

      const balanceUpdate =
        await tx
          .update(creditBalances)
          .set({
            availableCredits:
              availableAfter,
            reservedCredits:
              reservedAfter,
            updatedAt: new Date(),
          })
          .where(
            eq(
              creditBalances.id,
              balance.id,
            ),
          )
          .returning();

      const nextBalance =
        balanceUpdate[0];

      if (!nextBalance) {
        throw new CreditRepositoryError(
          "Credit balance reservation update failed",
          "NOT_FOUND",
        );
      }

      const reservationResult =
        await tx
          .insert(creditReservations)
          .values({
            creditBalanceId:
              balance.id,
            userId:
              balance.userId,
            organizationId:
              balance.organizationId,
            amount: input.amount,
            status: "reserved",
            referenceId:
              input.referenceId,
            idempotencyKey:
              input.idempotencyKey,
            expiresAt:
              input.expiresAt,
          })
          .returning();

      const reservation =
        reservationResult[0];

      if (!reservation) {
        throw new CreditRepositoryError(
          "Credit reservation insert failed",
          "NOT_FOUND",
        );
      }

      await tx
        .insert(creditTransactions)
        .values({
          creditBalanceId:
            balance.id,
          reservationId:
            reservation.id,
          userId:
            balance.userId,
          organizationId:
            balance.organizationId,
          type: "hold",
          source: "system",
          amount: input.amount,
          availableBalanceAfter:
            nextBalance.availableCredits,
          reservedBalanceAfter:
            nextBalance.reservedCredits,
          referenceId:
            input.referenceId,
            description:
            "Credits reserved",
        });

      return reservation;
}

/**
 * Reserve credits atomically.
 *
 * Public standalone transaction wrapper.
 */
export async function reserveCredits(
  input: CreateCreditReservationInput,
) {
  return db.transaction(
    async (tx) =>
      reserveCreditsTx(
        tx,
        input,
      ),
  );
}
/**
 * Consume a reservation atomically.
 *
 * Consumption decreases reserved credits but does not
 * return them to available credits.
 */
export async function getCreditReservation(
  reservationId: string,
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  if (!reservationId?.trim()) {
    throw new CreditRepositoryError(
      "reservationId is required",
      "INVALID_INPUT",
    );
  }

  const result = await db
    .select()
    .from(creditReservations)
    .where(
      eq(
        creditReservations.id,
        reservationId,
      ),
    )
    .limit(1);

  const reservation = result[0];

  if (!reservation) {
    throw new CreditRepositoryError(
      "Credit reservation not found",
      "NOT_FOUND",
    );
  }

  if (!ownerMatches(reservation, owner)) {
    throw new CreditRepositoryError(
      "Credit reservation belongs to a different owner",
      "IDEMPOTENCY_CONFLICT",
    );
  }

  return reservation;
}
export async function consumeReservation(
  reservationId: string,
  referenceId: string | undefined,
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  return db.transaction(
    async (tx) => {
      const reservationResult =
        await tx
          .select()
          .from(creditReservations)
          .where(
            eq(
              creditReservations.id,
              reservationId,
            ),
          )
          .for("update")
          .limit(1);

      const reservation =
        reservationResult[0];

      if (!reservation) {
        throw new CreditRepositoryError(
          "Credit reservation not found",
          "NOT_FOUND",
        );
      }

      if (!ownerMatches(reservation, owner)) {
        throw new CreditRepositoryError(
          "Credit reservation belongs to a different owner",
          "IDEMPOTENCY_CONFLICT",
        );
      }

      if (
        reservation.status ===
        "consumed"
      ) {
        return reservation;
      }

      if (
        reservation.status !==
        "reserved"
      ) {
        throw new CreditRepositoryError(
          "Only reserved credits can be consumed",
          "INVALID_STATE",
        );
      }

      const balance =
        await getLockedBalanceByIdTx(
          tx,
          reservation.creditBalanceId,
        );

      if (!balance) {
        throw new CreditRepositoryError(
          "Credit balance not found",
          "NOT_FOUND",
        );
      }

      if (
        balance.reservedCredits <
        reservation.amount
      ) {
        throw new CreditRepositoryError(
          "Reserved credit balance is inconsistent",
          "INVALID_STATE",
        );
      }

      const reservedAfter =
        balance.reservedCredits -
        reservation.amount;

      const updatedBalance =
        await tx
          .update(creditBalances)
          .set({
            reservedCredits:
              reservedAfter,
            updatedAt: new Date(),
          })
          .where(
            eq(
              creditBalances.id,
              balance.id,
            ),
          )
          .returning();

      const nextBalance =
        updatedBalance[0];

      if (!nextBalance) {
        throw new CreditRepositoryError(
          "Credit balance consumption update failed",
          "NOT_FOUND",
        );
      }

      const updatedReservation =
        await tx
          .update(creditReservations)
          .set({
            status: "consumed",
            consumedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            eq(
              creditReservations.id,
              reservation.id,
            ),
          )
          .returning();

      const result =
        updatedReservation[0];

      if (!result) {
        throw new CreditRepositoryError(
          "Reservation consumption failed",
          "NOT_FOUND",
        );
      }

      await tx
        .insert(creditTransactions)
        .values({
          creditBalanceId:
            balance.id,
          reservationId:
            reservation.id,
          userId:
            balance.userId,
          organizationId:
            balance.organizationId,
          type: "consume",
          source: "system",
          amount: reservation.amount,
          availableBalanceAfter:
            nextBalance.availableCredits,
          reservedBalanceAfter:
            nextBalance.reservedCredits,
          referenceId:
            referenceId ??
            reservation.referenceId,
          description:
            "Reserved credits consumed",
        });

      return result;
    },
  );
}

/**
 * Release a reservation and return its credits
 * to the available balance.
 */
export type CreditTransaction =
  Parameters<
    Parameters<typeof db.transaction>[0]
  >[0];


export async function releaseReservationTx(
  tx: CreditTransaction,
  reservationId: string,
  referenceId: string | undefined,
  owner?: OwnerInput,
) {
  if (owner) {
    assertExactlyOneOwner(owner);
  }

  const reservationResult =
    await tx
      .select()
      .from(creditReservations)
      .where(
        eq(
          creditReservations.id,
          reservationId,
        ),
      )
      .for("update")
      .limit(1);

  const reservation =
    reservationResult[0];

  if (!reservation) {
    throw new CreditRepositoryError(
      "Credit reservation not found",
      "NOT_FOUND",
    );
  }

  if (
    owner &&
    !ownerMatches(
      reservation,
      owner,
    )
  ) {
    throw new CreditRepositoryError(
      "Credit reservation belongs to a different owner",
      "IDEMPOTENCY_CONFLICT",
    );
  }

  if (
    reservation.status ===
      "released" ||
    reservation.status ===
      "expired"
  ) {
    return reservation;
  }

  if (
    reservation.status !==
    "reserved"
  ) {
    throw new CreditRepositoryError(
      "Only reserved credits can be released",
      "INVALID_STATE",
    );
  }

  const balance =
    await getLockedBalanceByIdTx(
      tx,
      reservation.creditBalanceId,
    );

  if (!balance) {
    throw new CreditRepositoryError(
      "Credit balance not found",
      "NOT_FOUND",
    );
  }

  if (
    balance.reservedCredits <
    reservation.amount
  ) {
    throw new CreditRepositoryError(
      "Reserved credit balance is inconsistent",
      "INVALID_STATE",
    );
  }

  const availableAfter =
    balance.availableCredits +
    reservation.amount;

  const reservedAfter =
    balance.reservedCredits -
    reservation.amount;

  const balanceUpdate =
    await tx
      .update(creditBalances)
      .set({
        availableCredits:
          availableAfter,
        reservedCredits:
          reservedAfter,
        updatedAt:
          new Date(),
      })
      .where(
        eq(
          creditBalances.id,
          balance.id,
        ),
      )
      .returning();

  const nextBalance =
    balanceUpdate[0];

  if (!nextBalance) {
    throw new CreditRepositoryError(
      "Credit balance release update failed",
      "NOT_FOUND",
    );
  }

  const updatedReservation =
    await tx
      .update(creditReservations)
      .set({
        status:
          "released",
        releasedAt:
          new Date(),
        updatedAt:
          new Date(),
      })
      .where(
        eq(
          creditReservations.id,
          reservation.id,
        ),
      )
      .returning();

  const result =
    updatedReservation[0];

  if (!result) {
    throw new CreditRepositoryError(
      "Reservation release failed",
      "NOT_FOUND",
    );
  }

  await tx
    .insert(creditTransactions)
    .values({
      creditBalanceId:
        balance.id,
      reservationId:
        reservation.id,
      userId:
        balance.userId,
      organizationId:
        balance.organizationId,
      type:
        "release",
      source:
        "system",
      amount:
        reservation.amount,
      availableBalanceAfter:
        nextBalance.availableCredits,
      reservedBalanceAfter:
        nextBalance.reservedCredits,
      referenceId:
        referenceId ??
        reservation.referenceId,
      description:
        "Reserved credits released",
    });

  return result;
}

export async function releaseReservation(
  reservationId: string,
  referenceId: string | undefined,
  owner?: OwnerInput,
) {
  return db.transaction(
    async (tx) =>
      releaseReservationTx(
        tx,
        reservationId,
        referenceId,
        owner,
      ),
  );
}
/**
 * Expire a reservation once its expiry time has passed.
 */
export async function expireReservation(
  reservationId: string,
  referenceId?: string,
) {
  return db.transaction(
    async (tx) => {
      const reservationResult =
        await tx
          .select()
          .from(creditReservations)
          .where(
            eq(
              creditReservations.id,
              reservationId,
            ),
          )
          .for("update")
          .limit(1);

      const reservation =
        reservationResult[0];

      if (!reservation) {
        throw new CreditRepositoryError(
          "Credit reservation not found",
          "NOT_FOUND",
        );
      }

      if (
        reservation.status !==
        "reserved"
      ) {
        return reservation;
      }

      if (
        !reservation.expiresAt ||
        reservation.expiresAt >
          new Date()
      ) {
        throw new CreditRepositoryError(
          "Reservation has not expired",
          "INVALID_STATE",
        );
      }

      const balance =
        await getLockedBalanceByIdTx(
          tx,
          reservation.creditBalanceId,
        );

      if (!balance) {
        throw new CreditRepositoryError(
          "Credit balance not found",
          "NOT_FOUND",
        );
      }

      if (
        balance.reservedCredits <
        reservation.amount
      ) {
        throw new CreditRepositoryError(
          "Reserved credit balance is inconsistent",
          "INVALID_STATE",
        );
      }

      const availableAfter =
        balance.availableCredits +
        reservation.amount;

      const reservedAfter =
        balance.reservedCredits -
        reservation.amount;

      const updatedBalance =
        await tx
          .update(creditBalances)
          .set({
            availableCredits:
              availableAfter,
            reservedCredits:
              reservedAfter,
            updatedAt: new Date(),
          })
          .where(
            eq(
              creditBalances.id,
              balance.id,
            ),
          )
          .returning();

      const nextBalance =
        updatedBalance[0];

      if (!nextBalance) {
        throw new CreditRepositoryError(
          "Credit balance expiry update failed",
          "NOT_FOUND",
        );
      }

      const updatedReservation =
        await tx
          .update(creditReservations)
          .set({
            status: "expired",
            releasedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            eq(
              creditReservations.id,
              reservation.id,
            ),
          )
          .returning();

      const result =
        updatedReservation[0];

      if (!result) {
        throw new CreditRepositoryError(
          "Reservation expiry failed",
          "NOT_FOUND",
        );
      }

      await tx
        .insert(creditTransactions)
        .values({
          creditBalanceId:
            balance.id,
          reservationId:
            reservation.id,
          userId:
            balance.userId,
          organizationId:
            balance.organizationId,
          type: "release",
          source: "system",
          amount: reservation.amount,
          availableBalanceAfter:
            nextBalance.availableCredits,
          reservedBalanceAfter:
            nextBalance.reservedCredits,
          referenceId:
            referenceId ??
            reservation.referenceId,
          description:
            "Expired reservation released",
        });

      return result;
    },
  );
}

/**
 * Record trusted server-side usage.
 *
 * request_id is unique at database level, making provider/job
 * retries idempotent at the usage-record layer.
 */
export async function recordUsage(
  input: RecordUsageSettlementInput,
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  if (
    !Number.isInteger(
      input.creditsUsed,
    ) ||
    input.creditsUsed < 0
  ) {
    throw new CreditRepositoryError(
      "creditsUsed must be a non-negative integer",
      "INVALID_AMOUNT",
    );
  }

  return db.transaction(
    async (tx) => {
      const existing =
        await tx
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              input.requestId,
            ),
          )
          .limit(1);

      if (existing[0]) {
        if (
          !ownerMatches(
            existing[0],
            owner,
          )
        ) {
          throw new CreditRepositoryError(
            "Usage request belongs to a different owner",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        return existing[0];
      }

      const result =
        await tx
          .insert(usageRecords)
          .values({
            requestId:
              input.requestId,
            userId:
              owner.userId ?? null,
            organizationId:
              owner.organizationId ??
              null,
            providerId:
              input.providerId,
            providerModelId:
              input.providerModelId,
            creditsUsed:
              input.creditsUsed,
            providerCostMinor:
              input.providerCostMinor,
            infrastructureCostMinor:
              input.infrastructureCostMinor,
            retryCostMinor:
              input.retryCostMinor,
            customerChargeMinor:
              input.customerChargeMinor,
            platformContributionMinor:
              input.platformContributionMinor,
            currency:
              input.currency,
          })
          .onConflictDoNothing({
            target:
              usageRecords.requestId,
          })
          .returning();

      const insertedUsage =
        result[0];

      if (insertedUsage) {
        return insertedUsage;
      }

      const concurrentExisting =
        await tx
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              input.requestId,
            ),
          )
          .limit(1);

      const usage =
        concurrentExisting[0];

      if (!usage) {
        throw new CreditRepositoryError(
          "Usage record could not be inserted or recovered after a concurrent request",
          "NOT_FOUND",
        );
      }

      if (
        !ownerMatches(
          usage,
          owner,
        )
      ) {
        throw new CreditRepositoryError(
          "Usage request belongs to a different owner",
          "IDEMPOTENCY_CONFLICT",
        );
      }

      return usage;
    },
  );
}

/**
 * Atomically consume a reservation and record the
 * trusted final usage event.
 *
 * This is the production settlement boundary.
 */
export async function settleReservation(
  input: {
    reservationId: string;
    referenceId?: string;
    usage: RecordUsageSettlementInput;
  },
  owner: OwnerInput,
) {
  assertExactlyOneOwner(owner);

  if (
    !Number.isInteger(
      input.usage.creditsUsed,
    ) ||
    input.usage.creditsUsed < 0
  ) {
    throw new CreditRepositoryError(
      "creditsUsed must be a non-negative integer",
      "INVALID_AMOUNT",
    );
  }

  return db.transaction(
    async (tx) => {
      /*
       * Serialize settlement against generation cancellation
       * for the same generation request.
       */
      await tx.execute(
        sql`
          select pg_advisory_xact_lock(
            hashtextextended(
              ${input.usage.requestId},
              0
            )
          )
        `,
      );

      const usageExisting =
        await tx
          .select()
          .from(usageRecords)
          .where(
            eq(
              usageRecords.requestId,
              input.usage.requestId,
            ),
          )
          .limit(1);

      if (usageExisting[0]) {
        const existingUsage =
          usageExisting[0];

        if (
          !ownerMatches(
            existingUsage,
            owner,
          )
        ) {
          throw new CreditRepositoryError(
            "Usage request belongs to a different owner",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        if (
          existingUsage.reservationId !==
          input.reservationId
        ) {
          throw new CreditRepositoryError(
            "Usage request is already bound to a different reservation",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        if (
          existingUsage.creditsUsed !==
          input.usage.creditsUsed
        ) {
          throw new CreditRepositoryError(
            "Usage request is already recorded with a different credit amount",
            "IDEMPOTENCY_CONFLICT",
          );
        }

        return {
          reservation: null,
          usage: existingUsage,
        };
      }

      const reservationResult =
        await tx
          .select()
          .from(creditReservations)
          .where(
            eq(
              creditReservations.id,
              input.reservationId,
            ),
          )
          .for("update")
          .limit(1);

      const reservation =
        reservationResult[0];

      if (!reservation) {
        throw new CreditRepositoryError(
          "Credit reservation not found",
          "NOT_FOUND",
        );
      }

      if (
        !ownerMatches(
          reservation,
          owner,
        )
      ) {
        throw new CreditRepositoryError(
          "Reservation belongs to a different owner",
          "IDEMPOTENCY_CONFLICT",
        );
      }

      if (
        reservation.status !==
        "reserved"
      ) {
        throw new CreditRepositoryError(
          "Only reserved credits can be settled",
          "INVALID_STATE",
        );
      }

      if (
        input.usage.creditsUsed >
        reservation.amount
      ) {
        throw new CreditRepositoryError(
          "Usage exceeds reserved credits",
          "INVALID_AMOUNT",
        );
      }

      const balance =
        await getLockedBalanceByIdTx(
          tx,
          reservation.creditBalanceId,
        );

      if (!balance) {
        throw new CreditRepositoryError(
          "Credit balance not found",
          "NOT_FOUND",
        );
      }

      if (
        balance.reservedCredits <
        reservation.amount
      ) {
        throw new CreditRepositoryError(
          "Reserved credit balance is inconsistent",
          "INVALID_STATE",
        );
      }

      const unused =
        reservation.amount -
        input.usage.creditsUsed;

      const availableAfter =
        balance.availableCredits +
        unused;

      const reservedAfter =
        balance.reservedCredits -
        reservation.amount;

      const updatedBalance =
        await tx
          .update(creditBalances)
          .set({
            availableCredits:
              availableAfter,
            reservedCredits:
              reservedAfter,
            updatedAt: new Date(),
          })
          .where(
            eq(
              creditBalances.id,
              balance.id,
            ),
          )
          .returning();

      const nextBalance =
        updatedBalance[0];

      if (!nextBalance) {
        throw new CreditRepositoryError(
          "Credit settlement balance update failed",
          "NOT_FOUND",
        );
      }

      const updatedReservation =
        await tx
          .update(creditReservations)
          .set({
            status: "consumed",
            consumedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            eq(
              creditReservations.id,
              reservation.id,
            ),
          )
          .returning();

      const settledReservation =
        updatedReservation[0];

      if (!settledReservation) {
        throw new CreditRepositoryError(
          "Reservation settlement failed",
          "NOT_FOUND",
        );
      }

      await tx
        .insert(creditTransactions)
        .values({
          creditBalanceId:
            balance.id,
          reservationId:
            reservation.id,
          userId:
            balance.userId,
          organizationId:
            balance.organizationId,
          type: "consume",
          source: "system",
          amount:
            input.usage.creditsUsed,
          availableBalanceAfter:
            nextBalance.availableCredits,
          reservedBalanceAfter:
            nextBalance.reservedCredits,
          referenceId:
            input.referenceId ??
            reservation.referenceId,
          description:
            "Credit reservation settled",
        });

      const usageResult =
        await tx
          .insert(usageRecords)
          .values({
            requestId:
              input.usage.requestId,
            reservationId:
              input.reservationId,
            userId:
              owner.userId ?? null,
            organizationId:
              owner.organizationId ??
              null,
            providerId:
              input.usage.providerId,
            providerModelId:
              input.usage.providerModelId,
            creditsUsed:
              input.usage.creditsUsed,
            providerCostMinor:
              input.usage.providerCostMinor,
            infrastructureCostMinor:
              input.usage.infrastructureCostMinor,
            retryCostMinor:
              input.usage.retryCostMinor,
            customerChargeMinor:
              input.usage.customerChargeMinor,
            platformContributionMinor:
              input.usage
                .platformContributionMinor,
            currency:
              input.usage.currency,
          })
          .returning();

      const usage =
        usageResult[0];

      if (!usage) {
        throw new CreditRepositoryError(
          "Usage record insert failed",
          "NOT_FOUND",
        );
      }

      return {
        reservation:
          settledReservation,
        usage,
      };
    },
  );
}

