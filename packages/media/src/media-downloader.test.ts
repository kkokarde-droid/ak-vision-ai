import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  downloadMedia,
  MediaDownloadError,
} from "./media-downloader.js";

test("downloads media to a local file", async () => {
  const server = createServer((_req, res) => {
    const body = Buffer.from("AK-Vision-AI-test-video");
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": body.length,
    });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const tempDir = await mkdtemp(join(tmpdir(), "ak-media-"));
    const outputPath = join(tempDir, "scene-1.mp4");

    try {
      const result = await downloadMedia({
        url: `http://127.0.0.1:${address.port}/scene.mp4`,
        outputPath,
      });

      assert.equal(result, outputPath);
      assert.deepEqual(
        await readFile(outputPath),
        Buffer.from("AK-Vision-AI-test-video"),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("rejects non-http media URL", async () => {
  await assert.rejects(
    () =>
      downloadMedia({
        url: "file:///scene.mp4",
        outputPath: "scene.mp4",
      }),
    (error: unknown) =>
      error instanceof MediaDownloadError &&
      error.message === "Media URL must use HTTP or HTTPS.",
  );
});

test("rejects non-success HTTP response", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    await assert.rejects(
      () =>
        downloadMedia({
          url: `http://127.0.0.1:${address.port}/missing.mp4`,
          outputPath: join(tmpdir(), "missing.mp4"),
        }),
      (error: unknown) =>
        error instanceof MediaDownloadError &&
        error.message === "Media download failed: HTTP 404.",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("rejects an already-aborted download", async () => {
  const controller = new AbortController();
  controller.abort(new Error("test abort"));

  await assert.rejects(
    () =>
      downloadMedia({
        url: "http://127.0.0.1:1/scene.mp4",
        outputPath: join(tmpdir(), "aborted.mp4"),
        signal: controller.signal,
      }),
    (error: unknown) =>
      error instanceof Error && error.message === "test abort",
  );
});
