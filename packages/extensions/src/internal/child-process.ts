import { spawn } from "node:child_process";

export type ChildProcessExecution = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  byteTruncated: boolean;
  stdout: string;
  stderr: string;
};

export function executeChildProcess(options: {
  file: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  abortSignal?: AbortSignal | undefined;
}): Promise<ChildProcessExecution> {
  return new Promise((resolve, reject) => {
    if (options.abortSignal?.aborted) {
      const reason = options.abortSignal.reason;
      reject(reason instanceof Error ? reason : new Error("Command execution aborted."));
      return;
    }

    const useProcessGroup = process.platform !== "win32";
    const child = spawn(options.file, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: useProcessGroup,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let collectedBytes = 0;
    let byteTruncated = false;
    let timedOut = false;
    let settled = false;
    let exited = false;
    let terminating = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const clearKillTimer = (): void => {
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
    };

    const terminateChild = (): void => {
      if (exited || terminating || child.pid === undefined) return;

      terminating = true;
      const pid = child.pid;

      try {
        if (useProcessGroup) {
          process.kill(-pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        return;
      }

      killTimer = setTimeout(() => {
        killTimer = undefined;

        if (exited) return;

        try {
          if (useProcessGroup) {
            process.kill(-pid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch {
          return;
        }
      }, 1_000);
      killTimer.unref();
    };

    const cleanupWaiters = (): void => {
      clearTimeout(timeoutTimer);
      options.abortSignal?.removeEventListener("abort", onAbort);

      if (exited) {
        clearKillTimer();
      }
    };

    const onAbort = (): void => {
      terminateChild();

      if (!settled) {
        settled = true;
        cleanupWaiters();
        const reason = options.abortSignal?.reason;
        reject(reason instanceof Error ? reason : new Error("Command execution aborted."));
      }
    };

    options.abortSignal?.addEventListener("abort", onAbort, { once: true });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, options.timeoutMs);
    timeoutTimer.unref();

    const appendChunk = (target: Buffer[], chunk: Buffer): void => {
      if (collectedBytes >= options.maxOutputBytes) {
        byteTruncated = true;
        return;
      }

      const remaining = options.maxOutputBytes - collectedBytes;

      if (chunk.byteLength <= remaining) {
        target.push(chunk);
        collectedBytes += chunk.byteLength;
      } else {
        target.push(chunk.subarray(0, remaining));
        collectedBytes += remaining;
        byteTruncated = true;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      appendChunk(stdoutChunks, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      appendChunk(stderrChunks, chunk);
    });

    child.once("exit", () => {
      exited = true;
      clearKillTimer();
    });

    child.on("error", (error) => {
      exited = true;
      clearKillTimer();

      if (settled) return;

      settled = true;
      cleanupWaiters();
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      exited = true;
      clearKillTimer();

      if (settled) return;

      settled = true;
      cleanupWaiters();
      resolve({
        exitCode,
        signal,
        timedOut,
        byteTruncated,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}
