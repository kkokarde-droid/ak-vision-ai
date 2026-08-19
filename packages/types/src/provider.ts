import type { ID, ISODateString } from "./common.js";
import type { AITaskType } from "./ai.js";

export type ProviderStatus =
  | "active"
  | "degraded"
  | "disabled";

export type ProviderCapability =
  | AITaskType
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video"
  | "video-to-video"
  | "text-to-audio"
  | "speech-to-text"
  | "text-to-speech"
  | "embeddings";

export interface Provider {
  id: ID;
  name: string;
  status: ProviderStatus;
  capabilities: ProviderCapability[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ProviderModel {
  id: ID;
  providerId: ID;
  modelId: string;
  displayName: string;
  capabilities: ProviderCapability[];
  active: boolean;
}

export interface ProviderPricing {
  id: ID;
  providerModelId: ID;
  currency: string;
  unit: string;
  unitPriceMinor: number;
  effectiveFrom: ISODateString;
  effectiveTo?: ISODateString;
}

export interface ProviderHealth {
  providerId: ID;
  available: boolean;
  latencyMs?: number;
  checkedAt: ISODateString;
}
