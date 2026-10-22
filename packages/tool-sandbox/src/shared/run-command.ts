import { type ChildProcessWithoutNullStreams, type SpawnOptions, spawn } from "node:child_process";
import { createOutputCollector } from "./output";

export interface CommandResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface RunCommandOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  timeoutMs?: number | undefined;
  maxOutputBytes?: number | undefined;
  input?: string | Uint8Array | undefined;
  signal?: AbortSignal | undefined;
  onStdout?: ((chunk: Uint8Array) => void) | undefined;
  onStderr?: ((chunk: Uint8Array) => void) | undefined;
  /**
   * Run the command as a process-group leader and signal the whole group on timeout or abort,
   * so background children cannot outlive the call.
   */
  killProcessGroup?: boolean | undefined;
  /**
   * After the command exits, wait at most this long for its output pipes to close. A background
   * child that inherited stdout would otherwise keep the call open indefinitely.
   */
  exitGraceMs?: number | undefined;
  /** Convert a spawn failure into a result, or return the error to reject with. */
  mapSpawnError?: ((error: NodeJS.ErrnoException) => CommandResult | Error) | undefined;
}

const defaultMaxOutputBytes = 1024 * 1024;

/** Spawn a command without a shell and collect bounded output. */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const startedAt = Date.now();
  const maxOutputBytes = options.maxOutputBytes ?? defaultMaxOutputBytes;
  const stdout = createOutputCollector(maxOutputBytes, options.onStdout);
  const stderr = createOutputCollector(maxOutputBytes, options.onStderr);

  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = { stdio: ["pipe", "pipe", "pipe"] };
    if (options.cwd !== undefined) spawnOptions.cwd = options.cwd;
    if (options.env !== undefined) spawnOptions.env = options.env;
    if (options.killProcessGroup === true) spawnOptions.detached = true;
    const child = spawn(command, [...args], spawnOptions) as ChildProcessWithoutNullStreams;

    let timedOut = false;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const kill = () => {
      if (options.killProcessGroup === true && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // The group is already gone; fall back to the direct child.
        }
      }
      child.kill("SIGKILL");
    };

    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            kill();
          }, options.timeoutMs);

    const abort = () => kill();

    if (options.signal?.aborted === true) {
      abort();
    } else {
      options.signal?.addEventListener("abort", abort, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", abort);
    };

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();

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
    };

    child.stdout.on("data", (chunk: Buffer) => stdout.accept(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.accept(chunk));
    // A command that exits without reading its input closes the pipe; that is not our failure.
    child.stdin.on("error", () => undefined);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const mapped = options.mapSpawnError?.(error) ?? error;
      if (mapped instanceof Error) reject(mapped);
      else resolve(mapped);
    });

    if (options.exitGraceMs !== undefined) {
      const graceMs = options.exitGraceMs;
      child.on("exit", (code) => {
        graceTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(code);
        }, graceMs);
        graceTimer.unref?.();
      });
    }

    child.on("close", finish);

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}
