import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runFFmpeg } from "./ffmpeg.js";
import { composeReel } from "./reel-composer.js";

test("composes multiple video clips into a 9:16 reel", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "ak-vision-media-"),
  );

  const clip1 = join(directory, "clip-1.mp4");
  const clip2 = join(directory, "clip-2.mp4");
  const output = join(directory, "reel.mp4");

  for (const clip of [clip1, clip2]) {
    await runFFmpeg({
      args: [
        "-f", "lavfi",
        "-i", "color=c=black:s=320x240:r=30",
        "-t", "1",
        "-an",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-y",
        clip,
      ],
    });
  }

  const result = await composeReel({
    clips: [
      {
        id: "scene-1",
        path: clip1,
        durationSeconds: 1,
      },
      {
        id: "scene-2",
        path: clip2,
        durationSeconds: 1,
      },
    ],
    outputPath: output,
    aspectRatio: "9:16",
  });

  assert.equal(result.clipCount, 2);
  assert.equal(result.durationSeconds, 2);

  const outputStats = await stat(output);
  assert.ok(outputStats.size > 0);
});
