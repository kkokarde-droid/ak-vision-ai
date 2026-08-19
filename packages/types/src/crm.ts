import type { ID, ISODateString } from "./common.js";

export type CRMLeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal"
  | "won"
  | "lost"
  | "nurture";

export type CRMDealStage =
  | "prospecting"
  | "qualification"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";

export type CRMActivityType =
  | "call"
  | "email"
  | "meeting"
  | "note"
  | "task"
  | "whatsapp"
  | "other";

export interface CRMCompany {
  id: ID;
  organizationId: ID;
  name: string;
  email?: string;
  phone?: string;
  website?: string;
  industry?: string;
  address?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CRMContact {
  id: ID;
  organizationId: ID;
  companyId?: ID;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CRMLead {
  id: ID;
  organizationId: ID;
  companyId?: ID;
  contactId?: ID;
  source?: string;
  status: CRMLeadStatus;
  score?: number;
  notes?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CRMDeal {
  id: ID;
  organizationId: ID;
  companyId?: ID;
  contactId?: ID;
  name: string;
  stage: CRMDealStage;
  valueMinor?: number;
  currency?: string;
  expectedCloseDate?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CRMActivity {
  id: ID;
  organizationId: ID;
  leadId?: ID;
  dealId?: ID;
  contactId?: ID;
  type: CRMActivityType;
  subject: string;
  description?: string;
  dueAt?: ISODateString;
  completedAt?: ISODateString;
  createdAt: ISODateString;
}
