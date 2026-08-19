import type { ID, ISODateString } from "./common.js";

export type AITaskType =
  | "chat"
  | "research"
  | "coding"
  | "image-generation"
  | "video-generation"
  | "audio-generation"
  | "website-generation"
  | "app-generation"
  | "document-generation"
  | "spreadsheet-generation"
  | "business-automation"
  | "agent"
  | "mcp";

export type AIRequestMode =
  | "fast"
  | "balanced"
  | "quality"
  | "auto";

export interface AIRequest {
  id: ID;
  userId: ID;
  organizationId: ID;
  projectId?: ID;
  conversationId?: ID;
  taskType: AITaskType;
  prompt: string;
  mode: AIRequestMode;
  modelId?: string;
  providerId?: string;
  input?: Record<string, unknown>;
  createdAt: ISODateString;
}

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  providerCostMinor?: number;
  platformCostMinor?: number;
}

export interface AIResponse<T = unknown> {
  requestId: ID;
  success: boolean;
  result?: T;
  errorCode?: string;
  errorMessage?: string;
  usage?: AIUsage;
  createdAt: ISODateString;
}
