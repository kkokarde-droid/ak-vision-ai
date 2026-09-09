import { randomUUID } from "node:crypto";
import {
  createReadStream,
} from "node:fs";
import {
  mkdir,
  rm,
  rename,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  pipeline,
} from "node:stream/promises";

import type {
  MediaStorage,
  PutMediaFileOptions,
  StoredMediaObject,
} from "./storage.js";

export interface LocalMediaStorageOptions {
  rootDirectory: string;
  publicBaseUrl?: string;
}

export class MediaStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

function assertNonEmpty(
  value: string,
  field: string,
): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new MediaStorageError(
      `${field} is required.`,
    );
  }

  return trimmed;
}

function normalizeKey(
  input: string,
): string {
  const key = assertNonEmpty(
    input,
    "Storage key",
  )
    .replaceAll("\\", "/");

  if (
    key.includes("\0") ||
    key.startsWith("/") ||
    key.startsWith("./") ||
    isAbsolute(key) ||
    /^[A-Za-z]:\//.test(key)
  ) {
    throw new MediaStorageError(
      "Storage key must be a relative path.",
    );
  }

  const parts = key.split("/");

  if (
    parts.some(
      (part) =>
        part === "" ||
        part === "." ||
        part === "..",
    )
  ) {
    throw new MediaStorageError(
      "Storage key contains an invalid path segment.",
    );
  }

  return parts.join("/");
}

export class LocalMediaStorage
  implements MediaStorage {
  private readonly rootDirectory: string;
  private readonly publicBaseUrl: string;

  constructor(
    options: LocalMediaStorageOptions,
  ) {
    this.rootDirectory = resolve(
      assertNonEmpty(
        options.rootDirectory,
        "Storage root directory",
      ),
    );

    this.publicBaseUrl = (
      options.publicBaseUrl?.trim() ||
      "storage://local"
    ).replace(/\/+$/, "");
  }

  private resolveKey(
    key: string,
  ): {
    normalizedKey: string;
    absolutePath: string;
  } {
    const normalizedKey =
      normalizeKey(key);

    const absolutePath =
      resolve(
        this.rootDirectory,
        ...normalizedKey.split("/"),
      );

    const rootWithSeparator =
      this.rootDirectory.endsWith(sep)
        ? this.rootDirectory
        : `${this.rootDirectory}${sep}`;

    if (
      absolutePath !== this.rootDirectory &&
      !absolutePath.startsWith(
        rootWithSeparator,
      )
    ) {
      throw new MediaStorageError(
        "Storage key resolves outside the storage root.",
      );
    }

    const relativePath =
      relative(
        this.rootDirectory,
        absolutePath,
      );

    if (
      relativePath.startsWith("..") ||
      isAbsolute(relativePath)
    ) {
      throw new MediaStorageError(
        "Storage key resolves outside the storage root.",
      );
    }

    return {
      normalizedKey,
      absolutePath,
    };
  }

  async putFile(
    options: PutMediaFileOptions,
  ): Promise<StoredMediaObject> {
    if (
      options.signal?.aborted
    ) {
      throw new MediaStorageError(
        "Media storage upload aborted.",
      );
    }

    const sourcePath =
      assertNonEmpty(
        options.sourcePath,
        "Source path",
      );

    const contentType =
      assertNonEmpty(
        options.contentType,
        "Content type",
      );

    const {
      normalizedKey,
      absolutePath,
    } = this.resolveKey(
      options.key,
    );

    let sourceStat;

    try {
      sourceStat = await stat(
        sourcePath,
      );
    } catch {
      throw new MediaStorageError(
        "Source media file was not found.",
      );
    }

    if (!sourceStat.isFile()) {
      throw new MediaStorageError(
        "Source media path must be a regular file.",
      );
    }

    await mkdir(
      dirname(absolutePath),
      {
        recursive: true,
      },
    );

    /*
     * Idempotency:
     * deterministic key => first complete writer wins.
     * Uploads happen through a temporary file and atomic rename,
     * so readers never observe a partial destination file.
     */
    try {
      const existing =
        await stat(
          absolutePath,
        );

      if (!existing.isFile()) {
        throw new MediaStorageError(
          "Storage destination exists and is not a file.",
        );
      }

      return {
        key: normalizedKey,
        url: this.getUrl(
          normalizedKey,
        ),
        contentType,
        sizeBytes:
          existing.size,
      };
    } catch (error) {
      if (
        error instanceof MediaStorageError
      ) {
        throw error;
      }
    }

    const temporaryPath =
      join(
        dirname(absolutePath),
        `.${basename(absolutePath)}.${randomUUID()}.uploading`,
      );

    try {
      const readable =
        createReadStream(
          sourcePath,
        );

      const writable =
        (
          await import("node:fs")
        ).createWriteStream(
          temporaryPath,
          {
            flags: "wx",
          },
        );

      if (options.signal !== undefined) {
        await pipeline(
          readable,
          writable,
          {
            signal:
              options.signal,
          },
        );
      } else {
        await pipeline(
          readable,
          writable,
        );
      }

      try {
        await rename(
          temporaryPath,
          absolutePath,
        );
      } catch (error) {
        /*
         * Another worker may have won the deterministic key race.
         * In that case the winner is the canonical object.
         */
        let winnerStat;

        try {
          winnerStat =
            await stat(
              absolutePath,
            );
        } catch {
          throw error;
        }

        return {
          key: normalizedKey,
          url: this.getUrl(
            normalizedKey,
          ),
          contentType,
          sizeBytes:
            winnerStat.size,
        };
      }

      const finalStat =
        await stat(
          absolutePath,
        );

      return {
        key: normalizedKey,
        url: this.getUrl(
          normalizedKey,
        ),
        contentType,
        sizeBytes:
          finalStat.size,
      };
    } catch (error) {
      if (
        options.signal?.aborted
      ) {
        throw new MediaStorageError(
          "Media storage upload aborted.",
        );
      }

      if (
        error instanceof MediaStorageError
      ) {
        throw error;
      }

      throw new MediaStorageError(
        `Media storage upload failed: ${
          error instanceof Error
            ? error.message
            : "unknown error"
        }`,
      );
    } finally {
      await rm(
        temporaryPath,
        {
          force: true,
        },
      ).catch(() => undefined);
    }
  }

  async openFile(
    key: string,
  ): Promise<{
    stream: import("node:stream").Readable;
    sizeBytes: number;
  }> {
    const {
      absolutePath,
    } = this.resolveKey(key);

    let fileStat;

    try {
      fileStat =
        await stat(
          absolutePath,
        );
    } catch {
      throw new MediaStorageError(
        "Stored media object was not found.",
      );
    }

    if (!fileStat.isFile()) {
      throw new MediaStorageError(
        "Stored media object is not a file.",
      );
    }

    return {
      stream:
        createReadStream(
          absolutePath,
        ),
      sizeBytes:
        fileStat.size,
    };
  }

  getUrl(
    key: string,
  ): string {
    const {
      normalizedKey,
    } = this.resolveKey(key);

    return `${this.publicBaseUrl}/${normalizedKey
      .split("/")
      .map((part) =>
        encodeURIComponent(part),
      )
      .join("/")}`;
  }

  async delete(
    key: string,
  ): Promise<void> {
    const {
      absolutePath,
    } = this.resolveKey(key);

    await rm(
      absolutePath,
      {
        force: true,
      },
    );
  }
}

