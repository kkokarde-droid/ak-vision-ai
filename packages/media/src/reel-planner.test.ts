import test from "node:test";
import assert from "node:assert/strict";

import {
  ReelPlanningError,
  validateReelGenerationSpec,
} from "./reel-planner.js";

const scene = (id: string, order: number, durationSeconds: number) => ({
  id,
  order,
  prompt: `Scene ${id}`,
  durationSeconds,
});

test("validates and sorts reel scenes", () => {
  const result = validateReelGenerationSpec({
    version: 1,
    aspectRatio: "9:16",
    durationSeconds: 10,
    scenes: [
      scene("scene-2", 1, 5),
      scene("scene-1", 0, 5),
    ],
  });

  assert.deepEqual(
    result.scenes.map((item) => item.id),
    ["scene-1", "scene-2"],
  );
  assert.equal(result.totalDurationSeconds, 10);
});

test("rejects duplicate scene order", () => {
  assert.throws(
    () =>
      validateReelGenerationSpec({
        version: 1,
        aspectRatio: "9:16",
        durationSeconds: 10,
        scenes: [
          scene("scene-1", 0, 5),
          scene("scene-2", 0, 5),
        ],
      }),
    ReelPlanningError,
  );
});

test("rejects duration mismatch", () => {
  assert.throws(
    () =>
      validateReelGenerationSpec({
        version: 1,
        aspectRatio: "9:16",
        durationSeconds: 10,
        scenes: [
          scene("scene-1", 0, 5),
          scene("scene-2", 1, 4),
        ],
      }),
    ReelPlanningError,
  );
});
