import type { ID } from "./common.js";

export type ReelAspectRatio =
  | "9:16"
  | "4:5"
  | "16:9";

export type ReelSceneTransition =
  | "cut"
  | "fade"
  | "dissolve";

export interface ReelScene {
  id: ID;
  order: number;
  prompt: string;
  imageUrl?: string;
  durationSeconds: number;
  transition?: ReelSceneTransition;
  imagePrompt?: string;
  videoPrompt?: string;
  voiceoverText?: string;
  subtitleText?: string;
  metadata?: Record<string, unknown>;
}

export interface ReelGenerationSpec {
  version: 1;
  aspectRatio: ReelAspectRatio;
  durationSeconds: number;
  language?: string;
  scenes: ReelScene[];
  metadata?: Record<string, unknown>;
}
