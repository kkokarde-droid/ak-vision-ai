import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReelSceneAIRequest,
} from "./reel-scene-adapter.js";

test("builds a Higgsfield-compatible 5 second scene request", () => {
  const result = buildReelSceneAIRequest(
    {
      id: "scene-1",
      order: 0,
      prompt: "A cinematic product shot",
      durationSeconds: 5,
      videoPrompt: "Slow cinematic product reveal",
    },
    {
      requestId: "req-scene-1",
      userId: "user-1",
      model: "dop-turbo",
      imageUrl: "https://example.com/product.jpg",
      enhancePrompt: true,
    },
  );

  assert.equal(result.taskType, "video-generation");
  assert.equal(result.prompt, "Slow cinematic product reveal");
  assert.equal(result.input?.model, "dop-turbo");
  assert.equal(result.input?.duration, 5);
  assert.equal(result.input?.imageUrl, "https://example.com/product.jpg");
  assert.equal(result.input?.enhance_prompt, true);
});

test("rejects unsupported Higgsfield scene duration", () => {
  assert.throws(() =>
    buildReelSceneAIRequest(
      {
        id: "scene-1",
        order: 0,
        prompt: "Test scene",
        durationSeconds: 10,
      },
      {
        requestId: "req-scene-2",
        userId: "user-1",
      },
    ),
  );
});

test("uses scene prompt when videoPrompt is absent", () => {
  const result = buildReelSceneAIRequest(
    {
      id: "scene-1",
      order: 0,
      prompt: "Product entering the frame",
      durationSeconds: 3,
    },
    {
      requestId: "req-scene-3",
      userId: "user-1",
    },
  );

  assert.equal(result.prompt, "Product entering the frame");
  assert.equal(result.input?.duration, 3);
});
