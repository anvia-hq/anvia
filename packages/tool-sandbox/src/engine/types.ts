export type SandboxFileType = "file" | "directory" | "symlink" | "other";

export type SandboxState =
  | "running"
  | "stopping"
  | "stopped"
  | "destroying"
  | "destroyed"
  | "error";

export type SandboxResources = Readonly<{
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
  sharedMemoryMb?: number;
}>;

export type SandboxRuntimeLimits = Readonly<{
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
  maxFileBytes?: number;
  maxProcesses?: number;
}>;

export type SandboxExecOptions = Readonly<{
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  input?: string | Uint8Array;
  abortSignal?: AbortSignal;
}>;

type SandboxExecResultBase = Readonly<{
  stdout: Uint8Array;
  stderr: Uint8Array;
  durationMs: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}>;

export type SandboxExecResult =
  | (SandboxExecResultBase & Readonly<{ status: "exited"; exitCode: number }>)
  | (SandboxExecResultBase & Readonly<{ status: "timed_out" }>);

export type SandboxExecStreamEvent =
  | Readonly<{ type: "stdout"; data: Uint8Array }>
  | Readonly<{ type: "stderr"; data: Uint8Array }>
  | Readonly<{ type: "result"; result: SandboxExecResult }>;

export type SandboxReadFileOptions = Readonly<{
  path: string;
  abortSignal?: AbortSignal;
}>;

export type SandboxReadTextFilePageOptions = SandboxReadFileOptions &
  Readonly<{
    startLine?: number;
    lineCount?: number;
    maxBytes?: number;
  }>;

export type SandboxTextFilePage = Readonly<{
  content: string;
  startLine: number;
  endLine: number | null;
  nextStartLine: number | null;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
}>;

export type SandboxWriteFileOptions = Readonly<{
  path: string;
  data: Uint8Array;
  abortSignal?: AbortSignal;
}>;

export type SandboxWriteTextFileOptions = Readonly<{
  path: string;
  text: string;
  abortSignal?: AbortSignal;
}>;

export type SandboxListFilesOptions = Readonly<{
  path?: string;
  abortSignal?: AbortSignal;
}>;

export type SandboxFileEntry = Readonly<{
  path: string;
  type: SandboxFileType;
  size?: number;
}>;

export type SandboxPublishedPort = Readonly<{
  containerPort: number;
  host: "127.0.0.1";
  hostPort: number;
  protocol: "tcp";
}>;

export type SandboxWaitForPortOptions = Readonly<{
  containerPort: number;
  timeoutMs?: number;
  intervalMs?: number;
  abortSignal?: AbortSignal;
}>;

export type SandboxProcessStartOptions = Readonly<{
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  abortSignal?: AbortSignal;
}>;

export type SandboxProcessStatus = "running" | "exited" | "stopped";

export type SandboxProcessInfo = Readonly<{
  id: string;
  command: string;
  args: readonly string[];
  cwd?: string;
  status: SandboxProcessStatus;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
}>;

export type SandboxListProcessesOptions = Readonly<{
  abortSignal?: AbortSignal;
}>;

export type SandboxReadProcessLogsOptions = Readonly<{
  processId: string;
  tailBytes?: number;
  abortSignal?: AbortSignal;
}>;

export type SandboxProcessLogs = Readonly<{
  stdout: Uint8Array;
  stderr: Uint8Array;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}>;

export type SandboxStopProcessOptions = Readonly<{
  processId: string;
  gracePeriodMs?: number;
  abortSignal?: AbortSignal;
}>;

export interface SandboxRuntime {
  readonly id: string;
  readonly provider: string;
  readonly workdir: string;
  readonly publishedPorts: readonly SandboxPublishedPort[];

  exec(options: SandboxExecOptions): Promise<SandboxExecResult>;
  execStream(options: SandboxExecOptions): AsyncIterable<SandboxExecStreamEvent>;
  readFile(options: SandboxReadFileOptions): Promise<Uint8Array>;
  readTextFile(options: SandboxReadFileOptions): Promise<string>;
  readTextFilePage(options: SandboxReadTextFilePageOptions): Promise<SandboxTextFilePage>;
  writeFile(options: SandboxWriteFileOptions): Promise<void>;
  writeTextFile(options: SandboxWriteTextFileOptions): Promise<void>;
  listFiles(options?: SandboxListFilesOptions): Promise<readonly SandboxFileEntry[]>;
  startProcess(options: SandboxProcessStartOptions): Promise<SandboxProcessInfo>;
  listProcesses(options?: SandboxListProcessesOptions): Promise<readonly SandboxProcessInfo[]>;
  readProcessLogs(options: SandboxReadProcessLogsOptions): Promise<SandboxProcessLogs>;
  stopProcess(options: SandboxStopProcessOptions): Promise<SandboxProcessInfo>;
  waitForPort(options: SandboxWaitForPortOptions): Promise<SandboxPublishedPort>;
}
