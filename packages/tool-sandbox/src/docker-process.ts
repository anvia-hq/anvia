import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { decodeUtf8, runDockerCli } from "./docker-cli";
import { DockerSandboxError } from "./errors";
import { containerPath } from "./path";
import type {
  DockerSandboxProcessInfo,
  DockerSandboxProcessLogs,
  DockerSandboxProcessStartOptions,
} from "./types";

const processMarkerPrefix = "ANVIA_PROCESS";
// Establish a killable process group and report it before starting the user command. The wrapper
// waits for a host acknowledgement, so cancelling startup before the marker is accepted can only
// leave an idle wrapper that exits when Docker closes stdin, never an untracked user process.
const processLauncher = [
  'wrapper="$1"',
  "shift",
  // GNU setsid forks when it is already a process-group leader. `-w` keeps that launcher alive
  // until the new session exits, so Docker does not detach from a still-running managed process.
  "if command -v setsid >/dev/null 2>&1 && setsid -w true >/dev/null 2>&1; then",
  '  exec setsid -w sh -c "$wrapper" "$@"',
  "fi",
  'exec sh -c "$wrapper" "$@"',
].join("\n");

const processWrapper = [
  'marker="$1"',
  "shift",
  "group=$$",
  `printf '\\036%s:%s:%s\\036' "$marker" "$$" "$group"`,
  "IFS= read -r ready || exit 125",
  '[ "$ready" = "start" ] || exit 125',
  '"$@" &',
  "child=$!",
  "terminate() {",
  '  wait "$child" 2>/dev/null || true',
  "  exit 143",
  "}",
  "trap terminate TERM INT",
  'wait "$child"',
  "exit $?",
].join("\n");

interface DockerProcessManagerOptions {
  containerName: string;
  dockerPath: string;
  workdir: string;
  env: Record<string, string>;
  maxOutputBytes: number;
  maxProcesses: number;
  startupTimeoutMs: number;
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

interface ManagedProcessRecord {
  info: MutableProcessInfo;
  child: ChildProcessWithoutNullStreams;
  stdout: TailOutputCollector;
  stderr: TailOutputCollector;
  markerStart: Buffer;
  markerBuffer: Buffer;
  supervisorPid?: number;
  processGroupId?: number;
  spawnFailed: boolean;
  stopRequested: boolean;
  startResolved: boolean;
  resolveStarted: () => void;
  rejectStarted: (error: unknown) => void;
  started: Promise<void>;
  resolveClosed: () => void;
  closed: Promise<void>;
}

export class DockerProcessManager {
  private readonly records = new Map<string, ManagedProcessRecord>();
  private disposed = false;

  constructor(private readonly options: DockerProcessManagerOptions) {
    if (!Number.isInteger(options.maxProcesses) || options.maxProcesses < 0) {
      throw processError("Sandbox maxProcesses must be a non-negative integer.");
    }
    if (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes < 0) {
      throw processError("Sandbox maxOutputBytes must be a non-negative integer.");
    }
    if (!Number.isInteger(options.startupTimeoutMs) || options.startupTimeoutMs <= 0) {
      throw processError("Sandbox process startup timeout must be a positive integer.");
    }
  }

  async start(options: DockerSandboxProcessStartOptions): Promise<DockerSandboxProcessInfo> {
    this.assertActive();
    assertStartOptions(options);
    options.abortSignal?.throwIfAborted();
    await this.pruneCompletedRecords(options.abortSignal);

    const trackedCount = this.records.size;
    if (trackedCount >= this.options.maxProcesses) {
      throw processError(
        `Sandbox process limit reached (${trackedCount} >= ${this.options.maxProcesses}).`,
      );
    }

    const id = randomUUID();
    const marker = `${processMarkerPrefix}:${id}`;
    const dockerArgs = this.createExecArgs(options, marker);
    const child = spawn(this.options.dockerPath, dockerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let resolveStarted!: () => void;
    let rejectStarted!: (error: unknown) => void;
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const info: MutableProcessInfo = {
      id,
      command: options.command,
      args: [...(options.args ?? [])],
      status: "running",
      startedAt: new Date().toISOString(),
    };
    if (options.cwd !== undefined) info.cwd = options.cwd;

    const record: ManagedProcessRecord = {
      info,
      child,
      stdout: new TailOutputCollector(this.options.maxOutputBytes),
      stderr: new TailOutputCollector(this.options.maxOutputBytes),
      markerStart: Buffer.from(`\u001e${marker}:`),
      markerBuffer: Buffer.alloc(0),
      spawnFailed: false,
      stopRequested: false,
      startResolved: false,
      resolveStarted,
      rejectStarted,
      started,
      resolveClosed,
      closed,
    };
    this.records.set(id, record);
    this.observe(record);

    try {
      await this.waitForStart(record, options.abortSignal);
      record.startResolved = true;
      return copyProcessInfo(record.info);
    } catch (error) {
      if (await this.cleanupFailedStart(record)) this.records.delete(id);
      throw error;
    }
  }

  list(): DockerSandboxProcessInfo[] {
    this.assertActive();
    return [...this.records.values()].map((record) => copyProcessInfo(record.info));
  }

  logs(processId: string, tailBytes?: number): DockerSandboxProcessLogs {
    this.assertActive();
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
  ): Promise<DockerSandboxProcessInfo> {
    this.assertActive();
    const record = this.getRecord(processId);
    if (!Number.isInteger(gracePeriodMs) || gracePeriodMs < 0) {
      throw processError("Process gracePeriodMs must be a non-negative integer.");
    }

    try {
      if (!(await this.terminateRecord(record, gracePeriodMs, abortSignal))) {
        throw processError(`Sandbox process did not stop: ${processId}`);
      }
    } catch (error) {
      if (record.info.status === "running") record.stopRequested = false;
      throw error;
    }

    return copyProcessInfo(record.info);
  }

  async dispose(abortSignal?: AbortSignal): Promise<void> {
    if (this.disposed) return;
    abortSignal?.throwIfAborted();

    await Promise.all(
      [...this.records.values()].map(async (record) => {
        if (!(await this.terminateRecord(record, 1_000, abortSignal))) {
          throw processError(`Sandbox process did not stop: ${record.info.id}`);
        }
      }),
    );
    this.disposed = true;
  }

  private createExecArgs(options: DockerSandboxProcessStartOptions, marker: string): string[] {
    const args = ["exec", "-i", "-w", containerPath(this.options.workdir, options.cwd ?? ".")];
    for (const [key, value] of Object.entries({ ...this.options.env, ...options.env })) {
      args.push("-e", `${key}=${value}`);
    }
    args.push(
      this.options.containerName,
      "sh",
      "-c",
      processLauncher,
      "anvia-process-launcher",
      processWrapper,
      "anvia-managed-process",
      marker,
      options.command,
      ...(options.args ?? []),
    );
    return args;
  }

  private observe(record: ManagedProcessRecord): void {
    record.child.stdout.on("data", (chunk: Buffer) => this.acceptStdout(record, chunk));
    record.child.stderr.on("data", (chunk: Buffer) => record.stderr.accept(chunk));

    record.child.on("error", (error) => {
      record.spawnFailed = true;
      const normalized =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new DockerSandboxError("Docker CLI was not found.", "docker_unavailable", undefined, {
              cause: error,
            })
          : error;
      record.rejectStarted(normalized);
    });

    record.child.on("close", (code) => {
      if (record.markerBuffer.length > 0) {
        record.stdout.accept(record.markerBuffer);
        record.markerBuffer = Buffer.alloc(0);
      }
      record.info.status = record.stopRequested ? "stopped" : "exited";
      record.info.exitCode = code ?? 1;
      record.info.endedAt = new Date().toISOString();
      record.rejectStarted(
        processError(`Sandbox process exited before startup completed: ${record.info.id}`),
      );
      record.resolveClosed();
    });
  }

  private acceptStdout(record: ManagedProcessRecord, chunk: Buffer): void {
    if (record.supervisorPid !== undefined) {
      record.stdout.accept(chunk);
      return;
    }

    record.markerBuffer = Buffer.concat([record.markerBuffer, chunk]);
    const start = record.markerBuffer.indexOf(record.markerStart);
    if (start < 0) {
      const retainedBytes = Math.max(0, record.markerStart.length - 1);
      if (record.markerBuffer.length > retainedBytes) {
        const split = record.markerBuffer.length - retainedBytes;
        record.stdout.accept(record.markerBuffer.subarray(0, split));
        record.markerBuffer = record.markerBuffer.subarray(split);
      }
      return;
    }

    const end = record.markerBuffer.indexOf(0x1e, start + record.markerStart.length);
    if (end < 0) {
      if (start > 0) {
        record.stdout.accept(record.markerBuffer.subarray(0, start));
        record.markerBuffer = record.markerBuffer.subarray(start);
      }
      return;
    }

    const rawPids = decodeUtf8(
      record.markerBuffer.subarray(start + record.markerStart.length, end),
    ).split(":");
    const supervisorPid = Number(rawPids[0]);
    const processGroupId = Number(rawPids[1]);
    if (!isProcessId(supervisorPid) || !isProcessId(processGroupId) || rawPids.length !== 2) {
      record.rejectStarted(processError("Sandbox process returned invalid process IDs."));
      return;
    }

    if (start > 0) record.stdout.accept(record.markerBuffer.subarray(0, start));
    if (end + 1 < record.markerBuffer.length) {
      record.stdout.accept(record.markerBuffer.subarray(end + 1));
    }
    record.markerBuffer = Buffer.alloc(0);
    record.supervisorPid = supervisorPid;
    record.processGroupId = processGroupId;
    // Keep stdin attached for the lifetime of `docker exec -i`. Closing it makes the Docker CLI
    // return successfully while the in-container process keeps running, which would orphan the
    // process from status, logs, and lifecycle management.
    record.child.stdin.write("start\n");
    record.resolveStarted();
  }

  private async waitForStart(
    record: ManagedProcessRecord,
    abortSignal: AbortSignal | undefined,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new DockerSandboxError("Starting sandbox process timed out.", "timeout"));
      }, this.options.startupTimeoutMs);
      timeout.unref?.();
    });

    try {
      const abortPromise = new Promise<never>((_, reject) => {
        if (abortSignal === undefined) return;
        abort = () => reject(abortSignal.reason ?? new DOMException("Aborted", "AbortError"));
        if (abortSignal.aborted) abort();
        else abortSignal.addEventListener("abort", abort, { once: true });
      });
      await Promise.race([record.started, timeoutPromise, abortPromise]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (abort !== undefined) abortSignal?.removeEventListener("abort", abort);
    }
  }

  private async cleanupFailedStart(record: ManagedProcessRecord): Promise<boolean> {
    record.stopRequested = true;
    if (record.processGroupId === undefined && record.info.status === "running") {
      record.child.stdin.destroy();
      record.child.kill("SIGKILL");
      await waitForPromise(record.closed, 1_000);
    }

    try {
      return await this.terminateRecord(record, 1_000);
    } catch {
      return false;
    }
  }

  private async terminateRecord(
    record: ManagedProcessRecord,
    gracePeriodMs: number,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    abortSignal?.throwIfAborted();
    record.stopRequested = true;

    if (record.processGroupId === undefined) {
      if (record.info.status === "running") {
        await waitForPromise(record.closed, Math.min(gracePeriodMs, 250), abortSignal);
      }
      if (record.processGroupId === undefined) {
        return record.info.status !== "running";
      }
    }

    if (!(await this.isProcessGroupRunning(record, abortSignal))) {
      return this.finishAfterGroupExit(record, abortSignal);
    }

    await this.signal(record, "TERM", abortSignal);
    if (await this.waitForRecordExit(record, gracePeriodMs, abortSignal)) return true;

    await this.signal(record, "KILL", abortSignal);
    if (await this.waitForRecordExit(record, 1_000, abortSignal)) return true;

    return false;
  }

  private async waitForRecordExit(
    record: ManagedProcessRecord,
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      abortSignal?.throwIfAborted();
      if (!(await this.isProcessGroupRunning(record, abortSignal))) {
        return this.finishAfterGroupExit(record, abortSignal);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return false;
      const intervalMs = Math.min(50, remainingMs);
      if (record.info.status === "running") {
        await waitForPromise(record.closed, intervalMs, abortSignal);
      } else {
        await waitForDelay(intervalMs, abortSignal);
      }
    }
  }

  private async finishAfterGroupExit(
    record: ManagedProcessRecord,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    if (record.info.status !== "running") return true;
    record.child.kill("SIGKILL");
    return waitForPromise(record.closed, 1_000, abortSignal);
  }

  private async isProcessGroupRunning(
    record: ManagedProcessRecord,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    if (record.processGroupId === undefined) return false;
    const result = await runDockerCli(
      [
        "exec",
        this.options.containerName,
        "sh",
        "-c",
        'kill -0 "-$1" 2>/dev/null',
        "anvia-process-group-check",
        `${record.processGroupId}`,
      ],
      {
        dockerPath: this.options.dockerPath,
        timeoutMs: 5_000,
        maxOutputBytes: this.options.maxOutputBytes,
        signal: abortSignal,
      },
    );
    return result.exitCode === 0;
  }

  private async signal(
    record: ManagedProcessRecord,
    dockerSignal: "TERM" | "KILL",
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (record.processGroupId === undefined) return;
    const result = await runDockerCli(
      [
        "exec",
        this.options.containerName,
        "sh",
        "-c",
        'kill "-$2" "-$1" 2>/dev/null || ! kill -0 "-$1" 2>/dev/null',
        "anvia-process-signal",
        `${record.processGroupId}`,
        dockerSignal,
      ],
      {
        dockerPath: this.options.dockerPath,
        timeoutMs: 5_000,
        maxOutputBytes: this.options.maxOutputBytes,
        signal: abortSignal,
      },
    );
    if (result.exitCode !== 0) {
      throw new DockerSandboxError(
        `Unable to stop sandbox process: ${record.info.id}`,
        "docker_command_failed",
        result,
      );
    }
  }

  private getRecord(processId: string): ManagedProcessRecord {
    const record = this.records.get(processId);
    if (record === undefined) {
      throw processError(`Unknown sandbox process: ${processId}`);
    }
    return record;
  }

  private async pruneCompletedRecords(abortSignal?: AbortSignal): Promise<void> {
    for (const [id, record] of this.records) {
      if (this.records.size < this.options.maxProcesses) return;
      const cleanupConfirmed =
        record.processGroupId === undefined
          ? record.spawnFailed
          : !(await this.isProcessGroupRunning(record, abortSignal));
      if (record.info.status !== "running" && cleanupConfirmed) {
        this.records.delete(id);
      }
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw processError("Sandbox process manager has been disposed.");
    }
  }
}

class TailOutputCollector {
  private chunks: Buffer[] = [];
  private length = 0;
  private didTruncate = false;

  constructor(private readonly maxBytes: number) {}

  accept(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (this.maxBytes <= 0) {
      this.didTruncate = true;
      return;
    }

    if (chunk.length >= this.maxBytes) {
      this.chunks = [chunk.subarray(chunk.length - this.maxBytes)];
      this.length = this.maxBytes;
      this.didTruncate = true;
      return;
    }

    this.chunks.push(chunk);
    this.length += chunk.length;
    while (this.length > this.maxBytes) {
      const first = this.chunks[0];
      if (first === undefined) break;
      const overflow = this.length - this.maxBytes;
      if (first.length <= overflow) {
        this.chunks.shift();
        this.length -= first.length;
      } else {
        this.chunks[0] = first.subarray(overflow);
        this.length -= overflow;
      }
      this.didTruncate = true;
    }
  }

  snapshot(tailBytes?: number): { bytes: Uint8Array; truncated: boolean } {
    if (tailBytes !== undefined && (!Number.isInteger(tailBytes) || tailBytes < 0)) {
      throw processError("Process tailBytes must be a non-negative integer.");
    }
    const bytes = Buffer.concat(this.chunks, this.length);
    const selected =
      tailBytes === 0
        ? Buffer.alloc(0)
        : tailBytes === undefined || bytes.length <= tailBytes
          ? bytes
          : bytes.subarray(bytes.length - tailBytes);
    return {
      bytes: new Uint8Array(selected.buffer, selected.byteOffset, selected.byteLength).slice(),
      truncated: this.didTruncate || selected.length < bytes.length,
    };
  }
}

function processError(message: string): DockerSandboxError {
  return new DockerSandboxError(message, "process");
}

function assertStartOptions(options: DockerSandboxProcessStartOptions): void {
  if (options.command.trim().length === 0) {
    throw processError("Sandbox process command cannot be empty.");
  }
}

function isProcessId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function copyProcessInfo(info: DockerSandboxProcessInfo): DockerSandboxProcessInfo {
  let copy: DockerSandboxProcessInfo = {
    id: info.id,
    command: info.command,
    args: [...info.args],
    status: info.status,
    startedAt: info.startedAt,
  };
  if (info.cwd !== undefined) copy = { ...copy, cwd: info.cwd };
  if (info.exitCode !== undefined) copy = { ...copy, exitCode: info.exitCode };
  if (info.endedAt !== undefined) copy = { ...copy, endedAt: info.endedAt };
  return copy;
}

async function waitForPromise(
  promise: Promise<void>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  abortSignal?.throwIfAborted();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
      }),
      new Promise<boolean>((_, reject) => {
        if (abortSignal === undefined) return;
        abort = () => reject(abortSignal.reason ?? new DOMException("Aborted", "AbortError"));
        if (abortSignal.aborted) abort();
        else abortSignal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abort !== undefined) abortSignal?.removeEventListener("abort", abort);
  }
}

async function waitForDelay(timeoutMs: number, abortSignal?: AbortSignal): Promise<void> {
  await waitForPromise(
    new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, timeoutMs);
      timeout.unref?.();
    }),
    timeoutMs,
    abortSignal,
  );
}
