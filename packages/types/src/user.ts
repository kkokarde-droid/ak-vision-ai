import type { ID, ISODateString } from "./common.js";

export type UserRole =
  | "customer"
  | "admin"
  | "super_admin";

export type UserStatus =
  | "active"
  | "suspended"
  | "pending"
  | "deleted";

export type AccountType =
  | "individual"
  | "business"
  | "enterprise";

export interface User {
  id: ID;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  accountType: AccountType;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Organization {
  id: ID;
  name: string;
  ownerUserId: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type OrganizationRole =
  | "owner"
  | "admin"
  | "member"
  | "billing";

export interface OrganizationMembership {
  id: ID;
  organizationId: ID;
  userId: ID;
  role: OrganizationRole;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
