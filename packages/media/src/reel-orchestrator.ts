import { buildReelSceneAIRequest } from "./reel-scene-adapter.js";
import type {
  AIRequest,
  AIResponse,
  ReelGenerationSpec,
  ReelScene,
} from "@ak-vision-ai/types";

import {
  validateReelGenerationSpec,
} from "./reel-planner.js";

import {
  composeReel,
} from "./reel-composer.js";

import type {
  ComposeReelResult,
  MediaClip,
} from "./composition.js";
export interface ReelSceneExecutionResult {
  scene: ReelScene;
  response: AIResponse<{
    provider: string;
    providerRequestId: string;
    status: "completed";
    output: {
      type: "video";
      url: string;
    };
    statusUrl?: string;
    cancelUrl?: string;
  }>;
}

export interface ReelOrchestratorDependencies {
  executeScene: (
    request: AIRequest,
    signal?: AbortSignal,
  ) => Promise<ReelSceneExecutionResult["response"]>;

  downloadClip: (
    url: string,
    scene: ReelScene,
    signal?: AbortSignal,
  ) => Promise<string>;

  compose: (
    options: Parameters<typeof composeReel>[0],
  ) => Promise<ComposeReelResult>;
}

export interface CreateReelOptions {
  spec: ReelGenerationSpec;
  requestId: string;
  userId: string;
  organizationId?: string;
  model?: "dop-lite" | "dop-turbo" | "dop-standard";
  signal?: AbortSignal;
}

export interface CreateReelResult {
  outputPath: string;
  durationSeconds: number;
  clipCount: number;
  scenes: ReelScene[];
}

export async function createReel(
  dependencies: ReelOrchestratorDependencies,
  options: CreateReelOptions,
): Promise<CreateReelResult> {
  const plan = validateReelGenerationSpec(options.spec);

  const clips: MediaClip[] = [];

  for (const scene of plan.scenes) {
    const request = buildReelSceneAIRequest(scene, {
  requestId: `${options.requestId}:${scene.id}`,
  userId: options.userId,
  ...(options.organizationId !== undefined
    ? { organizationId: options.organizationId }
    : {}),
  ...(options.model !== undefined
    ? { model: options.model }
    : {}),
  ...(scene.imageUrl !== undefined
    ? { imageUrl: scene.imageUrl }
    : {}),
});

    const response = await dependencies.executeScene(
      request,
      options.signal,
    );

    if (!response.success || !response.result?.output?.url) {
      throw new Error(
        response.errorMessage ||
          `Scene ${scene.id} video generation failed.`,
      );
    }

    const clipPath = await dependencies.downloadClip(
      response.result.output.url,
      scene,
      options.signal,
    );

    clips.push({
      id: scene.id,
      path: clipPath,
      durationSeconds: scene.durationSeconds,
      ...(scene.transition !== undefined
        ? { transition: scene.transition }
        : {}),
    });
  }

  const composed = await dependencies.compose({
    clips,
    outputPath: `${options.requestId}.mp4`,
    aspectRatio: plan.spec.aspectRatio,
    ...(options.signal !== undefined
      ? { signal: options.signal }
      : {}),
  });

  return {
    outputPath: composed.outputPath,
    durationSeconds: composed.durationSeconds,
    clipCount: composed.clipCount,
    scenes: plan.scenes,
  };
}


