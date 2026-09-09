import test from "node:test";
import assert from "node:assert/strict";

import {
  FFmpegError,
  runFFmpeg,
} from "./ffmpeg.js";

test("FFmpeg runner executes a valid command", async () => {
  const result = await runFFmpeg({
    args: [
      "-version",
    ],
  });

  assert.match(
    result.stdout + result.stderr,
    /ffmpeg version/i,
  );
});

test("FFmpeg runner rejects invalid arguments", async () => {
  await assert.rejects(
    () =>
      runFFmpeg({
        args: [
          "-this-option-does-not-exist",
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof FFmpegError);
      assert.notEqual(
        error.exitCode,
        0,
      );
      return true;
    },
  );
});

test("FFmpeg runner respects an already-aborted signal", async () => {
  const controller =
    new AbortController();

  controller.abort(
    new Error("test abort"),
  );

  await assert.rejects(
    () =>
      runFFmpeg({
        args: [
          "-version",
        ],
        signal:
          controller.signal,
      }),
    /test abort/,
  );
});
