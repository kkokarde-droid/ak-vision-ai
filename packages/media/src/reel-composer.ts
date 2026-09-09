import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ComposeReelOptions,
  ComposeReelResult,
} from "./composition.js";
import { runFFmpeg } from "./ffmpeg.js";

function aspectRatioFilter(
  aspectRatio: ComposeReelOptions["aspectRatio"],
): string {
  switch (aspectRatio) {
    case "9:16":
      return "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1";

    case "4:5":
      return "scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2,setsar=1";

    case "16:9":
      return "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";

    default:
      throw new Error(
        `Unsupported reel aspect ratio: ${aspectRatio}`,
      );
  }
}

export async function composeReel(
  options: ComposeReelOptions,
): Promise<ComposeReelResult> {
  if (options.clips.length === 0) {
    throw new Error(
      "At least one media clip is required.",
    );
  }

  const seenIds = new Set<string>();

  for (const clip of options.clips) {
    if (
      !clip.id.trim() ||
      !clip.path.trim()
    ) {
      throw new Error(
        "Every media clip requires a non-empty id and path.",
      );
    }

    if (seenIds.has(clip.id)) {
      throw new Error(
        `Duplicate media clip id: ${clip.id}`,
      );
    }

    seenIds.add(clip.id);

    if (
      clip.durationSeconds !== undefined &&
      (
        !Number.isFinite(
          clip.durationSeconds,
        ) ||
        clip.durationSeconds <= 0
      )
    ) {
      throw new Error(
        `Invalid duration for media clip: ${clip.id}`,
      );
    }
  }

  if (!options.outputPath.trim()) {
    throw new Error(
      "Output path is required.",
    );
  }

  await mkdir(
    dirname(options.outputPath),
    { recursive: true },
  );

  const filter = options.clips
    .map(
      (_, index) =>
        `[${index}:v]${aspectRatioFilter(
          options.aspectRatio,
        )},format=yuv420p[v${index}]`,
    )
    .join(";");

  const concatInputs = options.clips
    .map(
      (_, index) =>
        `[v${index}]`,
    )
    .join("");

  const args: string[] = [];

  for (const clip of options.clips) {
    args.push(
      "-i",
      clip.path,
    );
  }

  args.push(
    "-filter_complex",
    `${filter};${concatInputs}concat=n=${options.clips.length}:v=1:a=0[outv]`,
    "-map",
    "[outv]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    "-y",
    options.outputPath,
  );

  const ffmpegOptions = {
    args,
    ...(options.signal !== undefined
      ? { signal: options.signal }
      : {}),
  };

  await runFFmpeg(
    ffmpegOptions,
  );

  const durationSeconds =
    options.clips.reduce(
      (total, clip) =>
        total +
        (clip.durationSeconds ?? 0),
      0,
    );

  return {
    outputPath:
      options.outputPath,
    durationSeconds,
    clipCount:
      options.clips.length,
  };
}
