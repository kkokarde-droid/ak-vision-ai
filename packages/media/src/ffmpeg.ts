import { spawn } from "node:child_process";

export class FFmpegError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "FFmpegError";
  }
}

export interface FFmpegRunOptions {
  args: string[];
  cwd?: string;
  signal?: AbortSignal;
}

export interface FFmpegRunResult {
  stdout: string;
  stderr: string;
}

export function runFFmpeg(
  options: FFmpegRunOptions,
): Promise<FFmpegRunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(
        options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error("FFmpeg operation aborted."),
      );
      return;
    }

    const child = spawn(
      "ffmpeg",
      ["-hide_banner", "-nostdin", ...options.args],
      {
        cwd: options.cwd,
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const abortHandler = () => {
      child.kill("SIGTERM");
    };

    options.signal?.addEventListener(
      "abort",
      abortHandler,
      { once: true },
    );

    child.on("error", (error) => {
      options.signal?.removeEventListener(
        "abort",
        abortHandler,
      );

      reject(
        new FFmpegError(
          `Failed to start FFmpeg: ${error.message}`,
          undefined,
          stderr,
        ),
      );
    });

    child.on("close", (code) => {
      options.signal?.removeEventListener(
        "abort",
        abortHandler,
      );

      if (options.signal?.aborted) {
        reject(
          options.signal.reason instanceof Error
            ? options.signal.reason
            : new Error("FFmpeg operation aborted."),
        );
        return;
      }

      if (code !== 0) {
        reject(
          new FFmpegError(
            `FFmpeg exited with code ${code ?? "unknown"}.`,
            code ?? undefined,
            stderr,
          ),
        );
        return;
      }

      resolve({
        stdout,
        stderr,
      });
    });
  });
}
