import { spawn } from "node:child_process";
import { SandboxDockerCommandError, SandboxDockerUnavailableError } from "./errors";

export interface DockerCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface DockerCliOptions {
  dockerPath: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  input?: string | Uint8Array;
  signal?: AbortSignal;
  onStdout?: (chunk: Uint8Array) => void;
  onStderr?: (chunk: Uint8Array) => void;
}

const defaultMaxOutputBytes = 1024 * 1024;

export async function runDockerCli(
  args: string[],
  options: DockerCliOptions,
): Promise<DockerCliResult> {
  const startedAt = Date.now();
  const maxOutputBytes = options.maxOutputBytes ?? defaultMaxOutputBytes;
  const stdout = createOutputCollector(maxOutputBytes, options.onStdout);
  const stderr = createOutputCollector(maxOutputBytes, options.onStderr);

  return new Promise((resolve, reject) => {
    const child = spawn(options.dockerPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let timedOut = false;
    let aborted = false;
    let settled = false;

    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeoutMs);

    const abort = () => {
      aborted = true;
      child.kill("SIGKILL");
    };

    if (options.signal?.aborted === true) {
      abort();
    } else {
      options.signal?.addEventListener("abort", abort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer) => stdout.accept(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.accept(chunk));

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);

      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new SandboxDockerUnavailableError("Docker CLI was not found.", error));
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);

      resolve({
        stdout: stdout.text(),
        stderr: stderr.text(),
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

export async function assertDockerCli(args: string[], options: DockerCliOptions): Promise<string> {
  const result = await runDockerCli(args, options);

  if (result.exitCode !== 0) {
    throw new SandboxDockerCommandError(`Docker command failed: docker ${args.join(" ")}`, result);
  }

  return result.stdout.trim();
}

function createOutputCollector(maxBytes: number, onChunk?: (chunk: Uint8Array) => void) {
  const chunks: Buffer[] = [];
  let length = 0;
  let truncated = false;

  return {
    get truncated() {
      return truncated;
    },
    accept(chunk: Buffer) {
      onChunk?.(chunk);

      if (length >= maxBytes) {
        truncated = true;
        return;
      }

      const remaining = maxBytes - length;
      const next = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(next);
      length += next.length;

      if (next.length < chunk.length) {
        truncated = true;
      }
    },
    text() {
      return Buffer.concat(chunks, length).toString("utf8");
    },
  };
}
