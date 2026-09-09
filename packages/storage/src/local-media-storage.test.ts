import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import {
  tmpdir,
} from "node:os";
import {
  join,
} from "node:path";
import test from "node:test";

import {
  LocalMediaStorage,
  MediaStorageError,
} from "./local-media-storage.js";

async function createWorkspace(): Promise<string> {
  return mkdtemp(
    join(
      tmpdir(),
      "ak-vision-storage-",
    ),
  );
}

test(
  "uploads a file and returns a stable storage URL",
  async () => {
    const root =
      await createWorkspace();

    const source =
      join(
        root,
        "source.mp4",
      );

    await writeFile(
      source,
      Buffer.from(
        "AK Vision AI storage fixture",
      ),
    );

    const storage =
      new LocalMediaStorage({
        rootDirectory:
          join(root, "objects"),
        publicBaseUrl:
          "storage://local",
      });

    const result =
      await storage.putFile({
        sourcePath:
          source,
        key:
          "generations/job-123/final.mp4",
        contentType:
          "video/mp4",
      });

    assert.equal(
      result.key,
      "generations/job-123/final.mp4",
    );

    assert.equal(
      result.url,
      "storage://local/generations/job-123/final.mp4",
    );

    assert.equal(
      result.contentType,
      "video/mp4",
    );

    assert.ok(
      result.sizeBytes > 0,
    );

    const stored =
      await readFile(
        join(
          root,
          "objects",
          "generations",
          "job-123",
          "final.mp4",
        ),
      );

    assert.equal(
      stored.toString(),
      "AK Vision AI storage fixture",
    );
  },
);

test(
  "rejects path traversal",
  async () => {
    const root =
      await createWorkspace();

    const source =
      join(
        root,
        "source.mp4",
      );

    await writeFile(
      source,
      "fixture",
    );

    const storage =
      new LocalMediaStorage({
        rootDirectory:
          join(root, "objects"),
      });

    await assert.rejects(
      storage.putFile({
        sourcePath:
          source,
        key:
          "../escape.mp4",
        contentType:
          "video/mp4",
      }),
      (error) =>
        error instanceof
          MediaStorageError &&
        /relative path|invalid path segment/i.test(
          error.message,
        ),
    );
  },
);

test(
  "same deterministic key is idempotent",
  async () => {
    const root =
      await createWorkspace();

    const sourceOne =
      join(
        root,
        "one.mp4",
      );

    const sourceTwo =
      join(
        root,
        "two.mp4",
      );

    await writeFile(
      sourceOne,
      "FIRST",
    );

    await writeFile(
      sourceTwo,
      "SECOND-LONGER",
    );

    const storage =
      new LocalMediaStorage({
        rootDirectory:
          join(root, "objects"),
      });

    const first =
      await storage.putFile({
        sourcePath:
          sourceOne,
        key:
          "generations/job-123/final.mp4",
        contentType:
          "video/mp4",
      });

    const second =
      await storage.putFile({
        sourcePath:
          sourceTwo,
        key:
          "generations/job-123/final.mp4",
        contentType:
          "video/mp4",
      });

    assert.equal(
      second.key,
      first.key,
    );

    assert.equal(
      second.sizeBytes,
      first.sizeBytes,
    );

    const stored =
      await readFile(
        join(
          root,
          "objects",
          "generations",
          "job-123",
          "final.mp4",
        ),
        "utf8",
      );

    assert.equal(
      stored,
      "FIRST",
    );
  },
);

test(
  "aborted upload is rejected",
  async () => {
    const root =
      await createWorkspace();

    const source =
      join(
        root,
        "source.mp4",
      );

    await writeFile(
      source,
      "fixture",
    );

    const storage =
      new LocalMediaStorage({
        rootDirectory:
          join(root, "objects"),
      });

    const controller =
      new AbortController();

    controller.abort();

    await assert.rejects(
      storage.putFile({
        sourcePath:
          source,
        key:
          "generations/job-123/final.mp4",
        contentType:
          "video/mp4",
        signal:
          controller.signal,
      }),
      (error) =>
        error instanceof
          MediaStorageError &&
        error.message ===
          "Media storage upload aborted.",
    );
  },
);

test(
  "delete is idempotent",
  async () => {
    const root =
      await createWorkspace();

    const source =
      join(
        root,
        "source.mp4",
      );

    await writeFile(
      source,
      "fixture",
    );

    const storage =
      new LocalMediaStorage({
        rootDirectory:
          join(root, "objects"),
      });

    await storage.putFile({
      sourcePath:
        source,
      key:
        "generations/job-123/final.mp4",
      contentType:
        "video/mp4",
    });

    await storage.delete(
      "generations/job-123/final.mp4",
    );

    await storage.delete(
      "generations/job-123/final.mp4",
    );

    await assert.rejects(
      readFile(
        join(
          root,
          "objects",
          "generations",
          "job-123",
          "final.mp4",
        ),
      ),
    );
  },
);
