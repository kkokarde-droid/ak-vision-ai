import type { ID, ISODateString, CurrencyCode } from "./common.js";

export type CreditTransactionType =
  | "grant"
  | "purchase"
  | "usage"
  | "refund"
  | "adjustment"
  | "expiration";

export type CreditSource =
  | "free"
  | "subscription"
  | "purchase"
  | "promotion"
  | "admin";

export interface CreditBalance {
  id: ID;
  userId: ID;
  organizationId?: ID;
  availableCredits: number;
  reservedCredits: number;
  currency: CurrencyCode;
  updatedAt: ISODateString;
}

export interface CreditTransaction {
  id: ID;
  userId: ID;
  organizationId?: ID;
  type: CreditTransactionType;
  source: CreditSource;
  amount: number;
  balanceAfter: number;
  referenceId?: ID;
  description?: string;
  createdAt: ISODateString;
}

export interface UsageRecord {
  id: ID;
  userId: ID;
  organizationId?: ID;
  requestId: ID;
  providerId?: ID;
  providerModelId?: ID;
  creditsUsed: number;
  providerCostMinor?: number;
  customerChargeMinor?: number;
  platformMarginMinor?: number;
  currency: CurrencyCode;
  createdAt: ISODateString;
}
