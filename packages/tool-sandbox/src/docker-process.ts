import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { runDockerCli } from "./docker-cli";
import {
  SandboxDockerCommandError,
  SandboxDockerUnavailableError,
  SandboxProcessError,
  SandboxTimeoutError,
} from "./errors";
import { containerPath } from "./path";
import type {
  SandboxProcessInfo,
  SandboxProcessLogs,
  SandboxProcessLogsOptions,
  SandboxProcessStartOptions,
  SandboxProcessStopOptions,
} from "./types";

const processMarkerPrefix = "ANVIA_PROCESS";
// Report the supervisor and direct-child PIDs through a private stdout marker, then supervise the
// command so stopProcess can signal it without interpolating user-provided arguments into a shell.
const processWrapper = [
  'marker="$1"',
  "shift",
  '"$@" &',
  "child=$!",
  `printf '\\036%s:%s:%s\\036' "$marker" "$$" "$child"`,
  "terminate() {",
  '  kill -TERM "$child" 2>/dev/null || true',
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
  onExit?: (
    process: SandboxProcessInfo,
    logs: SandboxProcessLogs,
    durationMs: number,
  ) => void | Promise<void>;
}

interface ManagedProcessRecord {
  info: SandboxProcessInfo;
  startedAtMs: number;
  child: ChildProcessWithoutNullStreams;
  stdout: TailOutputCollector;
  stderr: TailOutputCollector;
  markerStart: Buffer;
  markerBuffer: Buffer;
  supervisorPid?: number;
  childPid?: number;
  stopRequested: boolean;
  startResolved: boolean;
  exitNotified: boolean;
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
      throw new SandboxProcessError("Sandbox maxProcesses must be a non-negative integer.");
    }
    if (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes < 0) {
      throw new SandboxProcessError("Sandbox maxOutputBytes must be a non-negative integer.");
    }
    if (!Number.isInteger(options.startupTimeoutMs) || options.startupTimeoutMs <= 0) {
      throw new SandboxProcessError("Sandbox process startup timeout must be a positive integer.");
    }
  }

  async start(options: SandboxProcessStartOptions): Promise<SandboxProcessInfo> {
    this.assertActive();
    assertStartOptions(options);
    this.pruneCompletedRecords();

    const runningCount = [...this.records.values()].filter(
      (record) => record.info.status === "running",
    ).length;
    if (runningCount >= this.options.maxProcesses) {
      throw new SandboxProcessError(
        `Sandbox process limit reached (${runningCount} >= ${this.options.maxProcesses}).`,
      );
    }

    const id = randomUUID();
    const marker = `${processMarkerPrefix}:${id}`;
    const dockerArgs = this.createExecArgs(options, marker);
    const child = spawn(this.options.dockerPath, dockerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();

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

    const info: SandboxProcessInfo = {
      id,
      command: options.command,
      args: [...(options.args ?? [])],
      status: "running",
      startedAt: new Date().toISOString(),
    };
    if (options.cwd !== undefined) info.cwd = options.cwd;

    const record: ManagedProcessRecord = {
      info,
      startedAtMs: Date.now(),
      child,
      stdout: new TailOutputCollector(this.options.maxOutputBytes),
      stderr: new TailOutputCollector(this.options.maxOutputBytes),
      markerStart: Buffer.from(`\u001e${marker}:`),
      markerBuffer: Buffer.alloc(0),
      stopRequested: false,
      startResolved: false,
      exitNotified: false,
      resolveStarted,
      rejectStarted,
      started,
      resolveClosed,
      closed,
    };
    this.records.set(id, record);
    this.observe(record);

    try {
      await this.waitForStart(record);
      record.startResolved = true;
      if (record.info.status !== "running") this.notifyExit(record);
      return copyProcessInfo(record.info);
    } catch (error) {
      this.records.delete(id);
      record.stopRequested = true;
      child.kill("SIGKILL");
      throw error;
    }
  }

  list(): SandboxProcessInfo[] {
    this.assertActive();
    return [...this.records.values()].map((record) => copyProcessInfo(record.info));
  }

  logs(processId: string, options: SandboxProcessLogsOptions = {}): SandboxProcessLogs {
    this.assertActive();
    const record = this.getRecord(processId);
    const stdout = record.stdout.snapshot(options.tailBytes);
    const stderr = record.stderr.snapshot(options.tailBytes);
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  }

  async stop(
    processId: string,
    options: SandboxProcessStopOptions = {},
  ): Promise<SandboxProcessInfo> {
    this.assertActive();
    const record = this.getRecord(processId);
    if (record.info.status !== "running") {
      return copyProcessInfo(record.info);
    }

    const gracePeriodMs = options.gracePeriodMs ?? 5_000;
    if (!Number.isInteger(gracePeriodMs) || gracePeriodMs < 0) {
      throw new SandboxProcessError("Process gracePeriodMs must be a non-negative integer.");
    }

    record.stopRequested = true;
    try {
      await this.signal(record, "TERM");
    } catch (error) {
      if (record.info.status === "running") record.stopRequested = false;
      throw error;
    }
    if (!(await waitForPromise(record.closed, gracePeriodMs))) {
      await this.signal(record, "KILL");
      if (!(await waitForPromise(record.closed, 1_000))) {
        record.child.kill("SIGKILL");
        throw new SandboxProcessError(`Sandbox process did not stop: ${processId}`);
      }
    }

    return copyProcessInfo(record.info);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const running = [...this.records.values()].filter((record) => record.info.status === "running");
    for (const record of running) record.stopRequested = true;

    await Promise.all(running.map((record) => waitForPromise(record.closed, 1_000)));
    for (const record of running) {
      if (record.info.status === "running") record.child.kill("SIGKILL");
    }
  }

  private createExecArgs(options: SandboxProcessStartOptions, marker: string): string[] {
    const args = ["exec", "-w", containerPath(this.options.workdir, options.cwd ?? ".")];
    for (const [key, value] of Object.entries({ ...this.options.env, ...options.env })) {
      args.push("-e", `${key}=${value}`);
    }
    args.push(
      this.options.containerName,
      "sh",
      "-c",
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
      const normalized =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new SandboxDockerUnavailableError("Docker CLI was not found.", error)
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
        new SandboxProcessError(
          `Sandbox process exited before startup completed: ${record.info.id}`,
        ),
      );
      record.resolveClosed();

      if (record.startResolved) this.notifyExit(record);
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

    const rawPids = record.markerBuffer
      .subarray(start + record.markerStart.length, end)
      .toString("utf8")
      .split(":");
    const supervisorPid = Number(rawPids[0]);
    const childPid = Number(rawPids[1]);
    if (!isProcessId(supervisorPid) || !isProcessId(childPid)) {
      record.rejectStarted(
        new SandboxProcessError("Sandbox process returned invalid process IDs."),
      );
      return;
    }

    if (start > 0) record.stdout.accept(record.markerBuffer.subarray(0, start));
    if (end + 1 < record.markerBuffer.length) {
      record.stdout.accept(record.markerBuffer.subarray(end + 1));
    }
    record.markerBuffer = Buffer.alloc(0);
    record.supervisorPid = supervisorPid;
    record.childPid = childPid;
    record.resolveStarted();
  }

  private async waitForStart(record: ManagedProcessRecord) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new SandboxTimeoutError("Starting sandbox process timed out."));
      }, this.options.startupTimeoutMs);
      timeout.unref?.();
    });

    try {
      await Promise.race([record.started, timeoutPromise]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async signal(record: ManagedProcessRecord, signal: "TERM" | "KILL"): Promise<void> {
    if (record.supervisorPid === undefined || record.childPid === undefined) return;
    const script =
      signal === "TERM"
        ? 'kill -TERM "$1" 2>/dev/null || true'
        : 'kill -KILL "$1" "$2" 2>/dev/null || true';
    const result = await runDockerCli(
      [
        "exec",
        this.options.containerName,
        "sh",
        "-c",
        script,
        "anvia-process-signal",
        String(record.supervisorPid),
        String(record.childPid),
      ],
      {
        dockerPath: this.options.dockerPath,
        timeoutMs: 5_000,
        maxOutputBytes: this.options.maxOutputBytes,
      },
    );
    if (result.exitCode !== 0 && record.info.status === "running") {
      throw new SandboxDockerCommandError(
        `Unable to stop sandbox process: ${record.info.id}`,
        result,
      );
    }
  }

  private getRecord(processId: string): ManagedProcessRecord {
    const record = this.records.get(processId);
    if (record === undefined) {
      throw new SandboxProcessError(`Unknown sandbox process: ${processId}`);
    }
    return record;
  }

  private pruneCompletedRecords(): void {
    for (const [id, record] of this.records) {
      if (this.records.size < this.options.maxProcesses) return;
      if (record.info.status !== "running") this.records.delete(id);
    }
  }

  private logsUnsafe(record: ManagedProcessRecord): SandboxProcessLogs {
    const stdout = record.stdout.snapshot();
    const stderr = record.stderr.snapshot();
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  }

  private notifyExit(record: ManagedProcessRecord): void {
    if (record.exitNotified) return;
    record.exitNotified = true;
    const durationMs = Date.now() - record.startedAtMs;
    const notify = async () =>
      this.options.onExit?.(copyProcessInfo(record.info), this.logsUnsafe(record), durationMs);
    void notify().catch(() => undefined);
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new SandboxProcessError("Sandbox process manager has been disposed.");
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

  snapshot(tailBytes?: number): { text: string; truncated: boolean } {
    if (tailBytes !== undefined && (!Number.isInteger(tailBytes) || tailBytes < 0)) {
      throw new SandboxProcessError("Process tailBytes must be a non-negative integer.");
    }
    const bytes = Buffer.concat(this.chunks, this.length);
    const selected =
      tailBytes === 0
        ? Buffer.alloc(0)
        : tailBytes === undefined || bytes.length <= tailBytes
          ? bytes
          : bytes.subarray(bytes.length - tailBytes);
    return {
      text: selected.toString("utf8"),
      truncated: this.didTruncate || selected.length < bytes.length,
    };
  }
}

function assertStartOptions(options: SandboxProcessStartOptions): void {
  if (options.command.trim().length === 0) {
    throw new SandboxProcessError("Sandbox process command cannot be empty.");
  }
}

function isProcessId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function copyProcessInfo(info: SandboxProcessInfo): SandboxProcessInfo {
  const copy: SandboxProcessInfo = {
    id: info.id,
    command: info.command,
    args: [...info.args],
    status: info.status,
    startedAt: info.startedAt,
  };
  if (info.cwd !== undefined) copy.cwd = info.cwd;
  if (info.exitCode !== undefined) copy.exitCode = info.exitCode;
  if (info.endedAt !== undefined) copy.endedAt = info.endedAt;
  return copy;
}

async function waitForPromise(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
