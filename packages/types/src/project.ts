import type { ID, ISODateString } from "./common.js";

export type ProjectType =
  | "general"
  | "research"
  | "coding"
  | "website"
  | "mobile-app"
  | "image"
  | "video"
  | "audio"
  | "business"
  | "erp"
  | "crm"
  | "automation";

export type ProjectStatus =
  | "active"
  | "archived"
  | "deleted";

export interface Project {
  id: ID;
  organizationId: ID;
  ownerUserId: ID;
  name: string;
  description?: string;
  type: ProjectType;
  status: ProjectStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
