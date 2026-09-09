import type { ReelGenerationSpec, ReelScene } from "@ak-vision-ai/types";

export class ReelPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReelPlanningError";
  }
}

export interface ReelScenePlan {
  spec: ReelGenerationSpec;
  scenes: ReelScene[];
  totalDurationSeconds: number;
}

export function validateReelGenerationSpec(
  spec: ReelGenerationSpec,
): ReelScenePlan {
  if (spec.version !== 1) {
    throw new ReelPlanningError("Unsupported reel specification version.");
  }

  if (!["9:16", "4:5", "16:9"].includes(spec.aspectRatio)) {
    throw new ReelPlanningError("Unsupported reel aspect ratio.");
  }

  if (
    !Number.isFinite(spec.durationSeconds) ||
    spec.durationSeconds <= 0
  ) {
    throw new ReelPlanningError("Reel duration must be positive.");
  }

  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) {
    throw new ReelPlanningError("Reel must contain at least one scene.");
  }

  const orders = new Set<number>();
  let totalDurationSeconds = 0;

  for (const scene of spec.scenes) {
    if (!scene.id || !scene.prompt.trim()) {
      throw new ReelPlanningError(
        "Every reel scene requires an id and prompt.",
      );
    }

    if (!Number.isInteger(scene.order) || scene.order < 0) {
      throw new ReelPlanningError(
        `Invalid scene order for ${scene.id}.`,
      );
    }

    if (orders.has(scene.order)) {
      throw new ReelPlanningError(
        `Duplicate scene order: ${scene.order}.`,
      );
    }

    orders.add(scene.order);

    if (
      !Number.isFinite(scene.durationSeconds) ||
      scene.durationSeconds <= 0
    ) {
      throw new ReelPlanningError(
        `Invalid duration for scene ${scene.id}.`,
      );
    }

    totalDurationSeconds += scene.durationSeconds;
  }

  if (Math.abs(totalDurationSeconds - spec.durationSeconds) > 0.001) {
    throw new ReelPlanningError(
      "Scene durations must equal the reel duration.",
    );
  }

  const scenes = [...spec.scenes].sort(
    (a, b) => a.order - b.order,
  );

  return {
    spec,
    scenes,
    totalDurationSeconds,
  };
}
