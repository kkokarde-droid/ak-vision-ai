import {
  addCredits,
  consumeReservation,
  expireReservation,
  getCreditBalance,
  getOrCreateCreditBalance,
  releaseReservation,
  recordUsage,
  reserveCredits,
  settleReservation,
} from "./credits.repository.js";

import { getCreditReservation as getCreditReservationRepository } from "./credits.repository.js";

import type {
  AddCreditsInput,
  ConsumeCreditReservationInput,
  CreateCreditReservationInput,
  CreditBalanceView,
  RecordUsageInput,
  RecordUsageSettlementInput,
  ReleaseCreditReservationInput,
} from "./credits.types.js";

export type CreditOwner = {
  userId?: string;
  organizationId?: string;
};

function assertExactlyOneOwner(
  owner: CreditOwner,
): void {
  const hasUser = Boolean(owner.userId);
  const hasOrganization =
    Boolean(owner.organizationId);

  if (hasUser === hasOrganization) {
    throw new Error(
      "Exactly one of userId or organizationId is required",
    );
  }
}

function toCreditBalanceView(
  balance: Awaited<
    ReturnType<typeof getCreditBalance>
  >,
): CreditBalanceView | null {
  if (!balance) {
    return null;
  }

  return {
    id: balance.id,
    userId: balance.userId,
    organizationId:
      balance.organizationId,
    availableCredits:
      balance.availableCredits,
    reservedCredits:
      balance.reservedCredits,
    currency: balance.currency,
    createdAt: balance.createdAt,
    updatedAt: balance.updatedAt,
  };
}

/**
 * Read the existing credit balance.
 *
 * This does not create an account.
 */
export async function getCredits(
  owner: CreditOwner,
): Promise<CreditBalanceView | null> {
  assertExactlyOneOwner(owner);

  const balance =
    await getCreditBalance(owner);

  return toCreditBalanceView(balance);
}

/**
 * Get the credit balance and create the account
 * when it does not exist yet.
 */
export async function ensureCreditAccount(
  owner: CreditOwner,
): Promise<CreditBalanceView> {
  assertExactlyOneOwner(owner);

  const balance =
    await getOrCreateCreditBalance(owner);

  return toCreditBalanceView(balance)!;
}

/**
 * Trusted/internal credit grant.
 *
 * Authorization MUST be enforced by the caller/route.
 * This service does not expose customer-controlled
 * financial fields.
 */
export async function grantCredits(
  input: AddCreditsInput,
) {
  assertExactlyOneOwner(input);

  return addCredits(input);
}

/**
 * Reserve credits for an in-progress operation.
 *
 * The repository performs the atomic balance update,
 * locking and idempotency protection.
 */
export async function reserveCredit(
  input: CreateCreditReservationInput,
) {
  assertExactlyOneOwner(input);

  return reserveCredits(input);
}

/**
 * Consume a previously reserved credit amount for the
 * authenticated/trusted owner.
 */
export async function consumeOwnedCreditReservation(
  input: ConsumeCreditReservationInput,
  owner: CreditOwner,
) {
  assertExactlyOneOwner(owner);

  return consumeReservation(
    input.reservationId,
    input.referenceId,
    owner,
  );
}

/**
 * Release a reservation and restore the credits
 * to the available balance.
 */
/**
 * Trusted/internal release of a reservation with explicit owner
 * binding. Worker/background callers must use this boundary so
 * reservation IDs cannot be used across tenants.
 */
export async function releaseOwnedCreditReservation(
  input: ReleaseCreditReservationInput,
  owner: CreditOwner,
) {
  assertExactlyOneOwner(owner);

  return releaseReservation(
    input.reservationId,
    input.referenceId,
    owner,
  );
}

export async function releaseCreditReservation(
  input: ReleaseCreditReservationInput,
) {
  return releaseReservation(
    input.reservationId,
    input.referenceId,
  );
}

/**
 * Expire a reservation and restore its credits.
 *
 * This is intended for trusted internal/background
 * processing rather than direct customer mutation.
 */
export async function expireCreditReservation(
  input: ReleaseCreditReservationInput,
) {
  return expireReservation(
    input.reservationId,
    input.referenceId,
  );
}

/**
 * Record trusted server-side usage.
 *
 * Owner identity is supplied separately so callers
 * cannot accidentally override tenant ownership through
 * customer/request payload data.
 */
export async function recordCreditUsage(
  input: RecordUsageInput,
  owner: CreditOwner,
) {
  assertExactlyOneOwner(owner);

  const trustedUsage: RecordUsageSettlementInput = {
  requestId: input.requestId,
  creditsUsed: input.creditsUsed,
  currency: input.currency ?? "INR",
  ...(input.providerId !== undefined
    ? { providerId: input.providerId }
    : {}),
  ...(input.providerModelId !== undefined
    ? { providerModelId: input.providerModelId }
    : {}),
};

  return recordUsage(
    trustedUsage,
    owner,
  );
}

/**
 * Atomically settle a reservation and record trusted
 * final usage.
 *
 * This is the production settlement boundary.
 */
/**
 * Read a generation credit reservation through the
 * service boundary with owner isolation.
 */
export async function getOwnedCreditReservation(
  input: {
    reservationId: string;
  },
  owner: CreditOwner,
) {
  assertExactlyOneOwner(owner);

  return getCreditReservationRepository(
    input.reservationId,
    owner,
  );
}
export async function settleCreditReservation(
  input: {
    reservationId: string;
    referenceId?: string;
    usage: RecordUsageSettlementInput;
  },
  owner: CreditOwner,
) {
  assertExactlyOneOwner(owner);

  return settleReservation(
    input,
    owner,
  );
}
