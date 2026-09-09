import type { ID, ISODateString } from "./common.js";
import type { ReelGenerationSpec } from "./reel.js";

export type GenerationType =
  | "text_to_video"
  | "image_to_video"
  | "video_to_video"
  | "ai_director"
  | "image"
  | "video"
  | "audio"
  | "speech"
  | "music"
  | "document"
  | "spreadsheet"
  | "presentation";

export type GenerationMode =
  | "text_to_video"
  | "image_to_video"
  | "video_to_video"
  | "ai_director";

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
  mode?: GenerationMode;
  status: GenerationStatus;
  priority: GenerationPriority;
  providerId?: ID;
  providerModelId?: ID;
  progress: number;
  prompt?: string;
  input?: Record<string, unknown> | ReelGenerationSpec;
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
