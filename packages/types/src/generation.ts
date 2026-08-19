import type { ID, ISODateString } from "./common.js";

export type GenerationType =
  | "image"
  | "video"
  | "audio"
  | "speech"
  | "music"
  | "document"
  | "spreadsheet"
  | "presentation";

export type GenerationStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationPriority =
  | "low"
  | "normal"
  | "high";

export interface GenerationJob {
  id: ID;
  requestId: ID;
  userId: ID;
  organizationId?: ID;
  type: GenerationType;
  status: GenerationStatus;
  priority: GenerationPriority;
  providerId?: ID;
  providerModelId?: ID;
  progress: number;
  prompt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: ISODateString;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  updatedAt: ISODateString;
}

export interface GenerationOutput {
  id: ID;
  jobId: ID;
  type: GenerationType;
  url: string;
  mimeType: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
  createdAt: ISODateString;
}
