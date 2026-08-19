import type { ID, ISODateString } from "./common.js";

export type ArtifactType =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "video"
  | "audio"
  | "code"
  | "website"
  | "webpage"
  | "mobile-app"
  | "desktop-app"
  | "pdf"
  | "data"
  | "other";

export type ArtifactStatus =
  | "draft"
  | "processing"
  | "ready"
  | "failed"
  | "archived";

export interface Artifact {
  id: ID;
  projectId?: ID;
  conversationId?: ID;
  ownerUserId: ID;
  organizationId?: ID;
  name: string;
  type: ArtifactType;
  status: ArtifactStatus;
  version: number;
  mimeType?: string;
  sizeBytes?: number;
  storageUrl?: string;
  previewUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ArtifactVersion {
  id: ID;
  artifactId: ID;
  version: number;
  storageUrl?: string;
  previewUrl?: string;
  changeSummary?: string;
  createdAt: ISODateString;
}
