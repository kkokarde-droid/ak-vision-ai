import type { ID, ISODateString, CurrencyCode } from "./common.js";

export type BusinessDocumentType =
  | "invoice"
  | "quotation"
  | "purchase-order"
  | "sales-order"
  | "receipt"
  | "delivery-challan"
  | "credit-note"
  | "debit-note"
  | "proposal"
  | "estimate"
  | "other";

export type BusinessDocumentStatus =
  | "draft"
  | "issued"
  | "sent"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "paid";

export interface BusinessParty {
  id?: ID;
  name: string;
  email?: string;
  phone?: string;
  taxId?: string;
  address?: string;
}

export interface BusinessDocumentItem {
  id: ID;
  description: string;
  quantity: number;
  unit?: string;
  unitPriceMinor: number;
  taxRate?: number;
  discountMinor?: number;
  totalMinor: number;
}

export interface BusinessDocument {
  id: ID;
  organizationId: ID;
  createdByUserId: ID;
  type: BusinessDocumentType;
  status: BusinessDocumentStatus;
  documentNumber: string;
  currency: CurrencyCode;
  customer?: BusinessParty;
  supplier?: BusinessParty;
  items: BusinessDocumentItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  notes?: string;
  issueDate: ISODateString;
  dueDate?: ISODateString;
  artifactId?: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
