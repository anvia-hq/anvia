import { spawn } from "node:child_process";
import { DockerSandboxError } from "./errors";

export interface DockerCliResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface DockerCliOptions {
  dockerPath: string;
  timeoutMs?: number | undefined;
  maxOutputBytes?: number | undefined;
  input?: string | Uint8Array | undefined;
  signal?: AbortSignal | undefined;
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
    let settled = false;

    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeoutMs);

    const abort = () => {
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
        reject(
          new DockerSandboxError("Docker CLI was not found.", "docker_unavailable", undefined, {
            cause: error,
          }),
        );
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

      if (options.signal?.aborted === true) {
        reject(options.signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }

      resolve({
        stdout: stdout.bytes(),
        stderr: stderr.bytes(),
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        timedOut,
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

export async function assertDockerCli(args: string[], options: DockerCliOptions): Promise<void> {
  const result = await runDockerCli(args, options);

  if (result.exitCode !== 0) {
    throw new DockerSandboxError(
      `Docker command failed: docker ${redactCliArgs(args).join(" ")}`,
      "docker_command_failed",
      result,
    );
  }
}

/** Flags whose following value is a `KEY=VALUE` assignment that may carry a secret. */
const envValueFlags = new Set(["--env", "-e"]);

/**
 * Replace secret values in a Docker argv before it is embedded in an error message, so
 * environment values passed with `--env`/`-e` never reach logs or traces. The variable
 * name is kept visible to keep the failure diagnosable.
 */
function redactCliArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    const flag = args[index - 1];
    if (flag !== undefined && envValueFlags.has(flag)) return redactEnvAssignment(arg);
    for (const envFlag of envValueFlags) {
      const prefix = `${envFlag}=`;
      if (arg.startsWith(prefix))
        return `${prefix}${redactEnvAssignment(arg.slice(prefix.length))}`;
    }
    return arg;
  });
}

function redactEnvAssignment(value: string): string {
  const separator = value.indexOf("=");
  return separator === -1 ? value : `${value.slice(0, separator + 1)}<redacted>`;
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
    bytes() {
      const bytes = Buffer.concat(chunks, length);
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
    },
  };
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
