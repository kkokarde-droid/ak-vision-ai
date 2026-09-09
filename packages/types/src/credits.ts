import type {
  CurrencyCode,
  ID,
  ISODateString,
} from "./common.js";

/**
 * A credit account belongs to exactly one owner:
 * either an individual user or an organization.
 */
export type CreditAccountOwner =
  | {
      userId: ID;
      organizationId: null;
    }
  | {
      userId: null;
      organizationId: ID;
    };

/**
 * Immutable accounting events.
 */
export type CreditLedgerEventType =
  | "grant"
  | "hold"
  | "consume"
  | "release"
  | "refund"
  | "adjustment"
  | "expiration";

/**
 * Business source/origin of the credit event.
 */
export type CreditSource =
  | "free"
  | "purchase"
  | "subscription"
  | "promotion"
  | "refund"
  | "admin"
  | "system";

/**
 * Current state of a credit account.
 */
export type CreditBalance =
  CreditAccountOwner & {
    id: ID;
    availableCredits: number;
    reservedCredits: number;
    currency: CurrencyCode;
    createdAt: ISODateString;
    updatedAt: ISODateString;
  };

/**
 * Current state of a credit reservation.
 */
export type CreditReservationStatus =
  | "reserved"
  | "consumed"
  | "released"
  | "expired";

export type CreditReservation =
  CreditAccountOwner & {
    id: ID;
    creditBalanceId: ID;
    amount: number;
    status: CreditReservationStatus;
    referenceId?: string;
    idempotencyKey: string;
    expiresAt?: ISODateString;
    releasedAt?: ISODateString;
    consumedAt?: ISODateString;
    createdAt: ISODateString;
    updatedAt: ISODateString;
  };

/**
 * Immutable credit ledger entry.
 */
export type CreditTransaction =
  CreditAccountOwner & {
    id: ID;
    creditBalanceId: ID;
    type: CreditLedgerEventType;
    source: CreditSource;
    amount: number;
    availableBalanceAfter: number;
    reservedBalanceAfter: number;
    referenceId?: string;
    reservationId?: ID;
    idempotencyKey?: string;
    description?: string;
    createdAt: ISODateString;
  };

/**
 * Internal/admin usage representation.
 *
 * Cost fields are server-generated.
 */
export type UsageRecord =
  CreditAccountOwner & {
    id: ID;
    requestId: ID;
    providerId?: string;
    providerModelId?: string;
    creditsUsed: number;
    providerCostMinor?: number;
    infrastructureCostMinor?: number;
    retryCostMinor?: number;
    customerChargeMinor?: number;
    platformContributionMinor?: number;
    currency: CurrencyCode;
    createdAt: ISODateString;
  };
