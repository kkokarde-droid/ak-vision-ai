import type {
  AIRequest,
  ReelScene,
} from "@ak-vision-ai/types";

export function buildReelSceneAIRequest(
  scene: ReelScene,
  options: {
    requestId: string;
    userId: string;
    organizationId?: string;
    model?: "dop-lite" | "dop-turbo" | "dop-standard";
    imageUrl?: string;
    seed?: number;
    enhancePrompt?: boolean;
  },
): AIRequest {
  if (!scene.prompt.trim()) {
    throw new Error(`Scene ${scene.id} has an empty prompt.`);
  }

  if (scene.durationSeconds !== 3 && scene.durationSeconds !== 5) {
    throw new Error(
      `Higgsfield scene duration must be 3 or 5 seconds; scene ${scene.id} has ${scene.durationSeconds}.`,
    );
  }

  const input: Record<string, unknown> = {
    model: options.model ?? "dop-turbo",
    duration: scene.durationSeconds,
    ...(options.imageUrl !== undefined
      ? { imageUrl: options.imageUrl }
      : {}),
    ...(options.seed !== undefined
      ? { seed: options.seed }
      : {}),
    ...(options.enhancePrompt !== undefined
      ? { enhance_prompt: options.enhancePrompt }
      : {}),
  };

  return {
    id: options.requestId,
    userId: options.userId,
    ...(options.organizationId !== undefined
      ? { organizationId: options.organizationId }
      : {}),
    taskType: "video-generation",
    prompt: scene.videoPrompt?.trim() || scene.prompt.trim(),
    mode: "quality",
    ...(options.model !== undefined
      ? { modelId: options.model }
      : {}),
    input,
    createdAt: new Date().toISOString(),
  };
}
