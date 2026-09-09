import type { ReelAspectRatio, ReelSceneTransition } from "@ak-vision-ai/types";

export interface MediaClip {
  id: string;
  path: string;
  durationSeconds?: number;
  transition?: ReelSceneTransition;
}

export interface ComposeReelOptions {
  clips: MediaClip[];
  outputPath: string;
  aspectRatio: ReelAspectRatio;
  signal?: AbortSignal;
}

export interface ComposeReelResult {
  outputPath: string;
  durationSeconds: number;
  clipCount: number;
}
