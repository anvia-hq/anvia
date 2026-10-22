import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { DockerSandboxError } from "../errors";
import {
  TailOutputCollector,
  copyProcessInfo,
  waitForDelay,
  waitForPromise,
} from "../shared/output";
import type { SandboxProcessInfo, SandboxProcessLogs, SandboxProcessStartOptions } from "../types";

export interface LocalProcessManagerOptions {
  maxOutputBytes: number;
  maxProcesses: number;
  /** Complete environment for managed processes. */
  environment: (extra?: Readonly<Record<string, string>>) => NodeJS.ProcessEnv;
}

type MutableProcessInfo = {
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  status: "running" | "exited" | "stopped";
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
};

interface ProcessRecord {
  info: MutableProcessInfo;
  child: ChildProcess;
  /** The leader's pid, which is also the process group id because children are detached. */
  groupId: number;
  stdout: TailOutputCollector;
  stderr: TailOutputCollector;
  stopRequested: boolean;
  exited: Promise<void>;
}

/**
 * Managed processes owned by the daemon. They live as long as the daemon, not as long as any
 * control-plane connection, which is what lets a hub restart reconnect to running work.
 */
export class LocalProcessManager {
  private readonly records = new Map<string, ProcessRecord>();

  constructor(private readonly options: LocalProcessManagerOptions) {}

  async start(
    options: SandboxProcessStartOptions,
    cwd: string,
    abortSignal?: AbortSignal,
  ): Promise<SandboxProcessInfo> {
    abortSignal?.throwIfAborted();
    if (options.command.trim().length === 0) {
      throw processError("Sandbox process command cannot be empty.");
    }
    this.prune();
    if (this.records.size >= this.options.maxProcesses) {
      throw processError(
        `Sandbox process limit reached (${this.records.size} >= ${this.options.maxProcesses}).`,
      );
    }

    const id = randomUUID();
    const child = spawn(options.command, [...(options.args ?? [])], {
      cwd,
      env: this.options.environment(options.env),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolveExited!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });
    const info: MutableProcessInfo = {
      id,
      command: options.command,
      args: [...(options.args ?? [])],
      status: "running",
      startedAt: new Date().toISOString(),
    };
    if (options.cwd !== undefined) info.cwd = options.cwd;

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error: NodeJS.ErrnoException) => {
        reject(
          error.code === "ENOENT"
            ? processError(`Unable to start sandbox process, command not found: ${options.command}`)
            : processError(`Unable to start sandbox process: ${error.message}`),
        );
      });
    });
    if (child.pid === undefined) throw processError("Sandbox process did not report a pid.");

    const record: ProcessRecord = {
      info,
      child,
      groupId: child.pid,
      stdout: new TailOutputCollector(this.options.maxOutputBytes),
      stderr: new TailOutputCollector(this.options.maxOutputBytes),
      stopRequested: false,
      exited,
    };
    child.stdout?.on("data", (chunk: Buffer) => record.stdout.accept(chunk));
    child.stderr?.on("data", (chunk: Buffer) => record.stderr.accept(chunk));
    child.on("error", () => undefined);
    child.on("exit", (code, signal) => {
      record.info.status = record.stopRequested ? "stopped" : "exited";
      record.info.exitCode =
        code ?? (signal === null ? 1 : 128 + (os.constants.signals[signal] ?? 0));
      record.info.endedAt = new Date().toISOString();
      resolveExited();
    });
    this.records.set(id, record);
    return copyProcessInfo(record.info);
  }

  list(): SandboxProcessInfo[] {
    return [...this.records.values()].map((record) => copyProcessInfo(record.info));
  }

  logs(processId: string, tailBytes?: number): SandboxProcessLogs {
    const record = this.getRecord(processId);
    const stdout = record.stdout.snapshot(tailBytes);
    const stderr = record.stderr.snapshot(tailBytes);
    return {
      stdout: stdout.bytes,
      stderr: stderr.bytes,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  }

  async stop(
    processId: string,
    gracePeriodMs = 5_000,
    abortSignal?: AbortSignal,
  ): Promise<SandboxProcessInfo> {
    const record = this.getRecord(processId);
    try {
      if (!(await this.terminate(record, gracePeriodMs, abortSignal))) {
        throw processError(`Sandbox process did not stop: ${processId}`);
      }
    } catch (error) {
      if (record.info.status === "running") record.stopRequested = false;
      throw error;
    }
    return copyProcessInfo(record.info);
  }

  /** Terminate everything. Used only when the daemon itself shuts down. */
  async dispose(): Promise<void> {
    await Promise.allSettled(
      [...this.records.values()].map((record) => this.terminate(record, 1_000)),
    );
  }

  private async terminate(
    record: ProcessRecord,
    gracePeriodMs: number,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    abortSignal?.throwIfAborted();
    record.stopRequested = true;
    if (!this.isGroupRunning(record)) return this.settled(record);

    this.signal(record, "SIGTERM");
    if (await this.waitForExit(record, gracePeriodMs, abortSignal)) return true;
    this.signal(record, "SIGKILL");
    return this.waitForExit(record, 1_000, abortSignal);
  }

  private async waitForExit(
    record: ProcessRecord,
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      abortSignal?.throwIfAborted();
      if (!this.isGroupRunning(record)) return this.settled(record);
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await waitForDelay(Math.min(25, remaining), abortSignal);
    }
  }

  private async settled(record: ProcessRecord): Promise<boolean> {
    return record.info.status !== "running" || (await waitForPromise(record.exited, 1_000));
  }

  private isGroupRunning(record: ProcessRecord): boolean {
    try {
      process.kill(-record.groupId, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  private signal(record: ProcessRecord, signal: "SIGTERM" | "SIGKILL"): void {
    try {
      process.kill(-record.groupId, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw new DockerSandboxError(
          `Unable to stop sandbox process: ${record.info.id}`,
          "process",
          undefined,
          { cause: error },
        );
      }
    }
  }

  private getRecord(processId: string): ProcessRecord {
    const record = this.records.get(processId);
    if (record === undefined) throw processError(`Unknown sandbox process: ${processId}`);
    return record;
  }

  /** Forget finished processes, oldest first, once the table is full. */
  private prune(): void {
    for (const [id, record] of this.records) {
      if (this.records.size < this.options.maxProcesses) return;
      if (record.info.status !== "running" && !this.isGroupRunning(record)) {
        this.records.delete(id);
      }
    }
  }
}

function processError(message: string): DockerSandboxError {
  return new DockerSandboxError(message, "process");
}
