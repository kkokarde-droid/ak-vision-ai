import type {
  CreditLedgerEventType,
  CreditSource,
  CreditReservationStatus,
} from "@ak-vision-ai/types";

export type {
  CreditLedgerEventType,
  CreditSource,
  CreditReservationStatus,
};

export type CreditBalanceView = {
  id: string;
  userId: string | null;
  organizationId: string | null;
  availableCredits: number;
  reservedCredits: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateCreditReservationInput = {
  userId?: string;
  organizationId?: string;
  amount: number;
  referenceId?: string;
  idempotencyKey: string;
  expiresAt?: Date;
};

export type ConsumeCreditReservationInput = {
  reservationId: string;
  referenceId?: string;
};

export type ReleaseCreditReservationInput = {
  reservationId: string;
  referenceId?: string;
};

/**
 * Server-side credit mutation.
 *
 * This must only be called by trusted internal/admin flows.
 */
export type AddCreditsInput = {
  userId?: string;
  organizationId?: string;
  amount: number;
  source: CreditSource;
  referenceId?: string;
  idempotencyKey: string;
  description?: string;
};

/**
 * Customer-controlled usage input.
 *
 * Financial cost fields deliberately do NOT exist here.
 * Provider/infrastructure/customer-charge data is calculated
 * server-side after trusted provider execution.
 */
export type RecordUsageInput = {
  requestId: string;
  userId?: string;
  organizationId?: string;
  providerId?: string;
  providerModelId?: string;
  creditsUsed: number;
  currency?: string;
};

/**
 * Internal server-side settlement data.
 */
export type RecordUsageSettlementInput = {
  requestId: string;
  providerId?: string;
  providerModelId?: string;
  creditsUsed: number;
  providerCostMinor?: number;
  infrastructureCostMinor?: number;
  retryCostMinor?: number;
  customerChargeMinor?: number;
  platformContributionMinor?: number;
  currency: string;
};
