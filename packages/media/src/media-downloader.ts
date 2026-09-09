import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  createWriteStream,
} from "node:fs";

import {
  mkdir,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  pipeline,
} from "node:stream/promises";

export class MediaDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaDownloadError";
  }
}

export interface DownloadMediaOptions {
  url: string;
  outputPath: string;
  signal?: AbortSignal;
}

export async function downloadMedia(
  options: DownloadMediaOptions,
): Promise<string> {
  if (!options.url.trim()) {
    throw new MediaDownloadError(
      "Media URL is required.",
    );
  }

  if (!/^https?:\/\//i.test(options.url)) {
    throw new MediaDownloadError(
      "Media URL must use HTTP or HTTPS.",
    );
  }

  if (!options.outputPath.trim()) {
    throw new MediaDownloadError(
      "Media output path is required.",
    );
  }

  if (options.signal?.aborted) {
    throw (
      options.signal.reason instanceof Error
        ? options.signal.reason
        : new MediaDownloadError(
            "Media download aborted.",
          )
    );
  }

  await mkdir(
    dirname(options.outputPath),
    {
      recursive: true,
    },
  );

  let response: Response;

  try {
    response = await fetch(
      options.url,
      options.signal !== undefined
        ? { signal: options.signal }
        : undefined,
    );
  } catch (error) {
    if (
      options.signal?.aborted
    ) {
      throw (
        options.signal.reason instanceof Error
          ? options.signal.reason
          : new MediaDownloadError(
              "Media download aborted.",
            )
      );
    }

    throw new MediaDownloadError(
      `Media download request failed: ${
        error instanceof Error
          ? error.message
          : "unknown error"
      }`,
    );
  }

  if (!response.ok) {
    throw new MediaDownloadError(
      `Media download failed: HTTP ${response.status}.`,
    );
  }

  if (!response.body) {
    throw new MediaDownloadError(
      "Media download returned an empty response body.",
    );
  }

  try {
    const readable = Readable.fromWeb(
  response.body as unknown as NodeReadableStream<any>,
);

const writable = createWriteStream(options.outputPath);

if (options.signal !== undefined) {
  await pipeline(readable, writable, {
    signal: options.signal,
  });
} else {
  await pipeline(readable, writable);
}
  } catch (error) {
    throw new MediaDownloadError(
      `Media download failed: ${
        error instanceof Error
          ? error.message
          : "unknown error"
      }`,
    );
  }

  return options.outputPath;
}
