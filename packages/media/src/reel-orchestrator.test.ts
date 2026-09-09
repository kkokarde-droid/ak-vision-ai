import test from "node:test";
import assert from "node:assert/strict";

import {
  createReel,
} from "./reel-orchestrator.js";

test("creates a reel from generated scene clips", async () => {
  const requests: string[] = [];
  const downloads: string[] = [];
  let composed = false;

  const result = await createReel(
    {
      executeScene: async (request) => {
        requests.push(request.id);

        return {
          requestId: request.id,
          success: true,
          result: {
            provider: "higgsfield",
            providerRequestId: `hf-${request.id}`,
            status: "completed",
            output: {
              type: "video",
              url: `https://example.com/${request.id}.mp4`,
            },
          },
          createdAt: new Date().toISOString(),
        };
      },

      downloadClip: async (url, scene) => {
        downloads.push(`${scene.id}:${url}`);
        return `C:\\temp\\${scene.id}.mp4`;
      },

      compose: async (options) => {
        composed = true;

        assert.equal(options.clips.length, 2);
        assert.equal(options.aspectRatio, "9:16");
        assert.equal(options.clips[0]?.id, "scene-1");
        assert.equal(options.clips[1]?.id, "scene-2");

        return {
          outputPath: "C:\\temp\\final.mp4",
          durationSeconds: 10,
          clipCount: 2,
        };
      },
    },
    {
      spec: {
        version: 1,
        aspectRatio: "9:16",
        durationSeconds: 10,
        scenes: [
          {
            id: "scene-1",
            order: 0,
            prompt: "Opening product shot",
            durationSeconds: 5,
          },
          {
            id: "scene-2",
            order: 1,
            prompt: "Product in use",
            durationSeconds: 5,
          },
        ],
      },
      requestId: "reel-1",
      userId: "user-1",
    },
  );

  assert.deepEqual(
    requests,
    ["reel-1:scene-1", "reel-1:scene-2"],
  );

  assert.equal(downloads.length, 2);
  assert.equal(composed, true);
  assert.equal(result.outputPath, "C:\\temp\\final.mp4");
  assert.equal(result.durationSeconds, 10);
  assert.equal(result.clipCount, 2);
});

test("fails when a scene generation returns no video", async () => {
  await assert.rejects(
    () =>
      createReel(
        {
          executeScene: async (request) => ({
            requestId: request.id,
            success: false,
            errorCode: "PROVIDER_GENERATION_FAILED",
            errorMessage: "Generation failed.",
            createdAt: new Date().toISOString(),
          }),

          downloadClip: async () => "unused.mp4",

          compose: async () => ({
            outputPath: "unused.mp4",
            durationSeconds: 5,
            clipCount: 1,
          }),
        },
        {
          spec: {
            version: 1,
            aspectRatio: "9:16",
            durationSeconds: 5,
            scenes: [
              {
                id: "scene-1",
                order: 0,
                prompt: "Test scene",
                durationSeconds: 5,
              },
            ],
          },
          requestId: "reel-2",
          userId: "user-1",
        },
      ),
    /Generation failed/,
  );
});
