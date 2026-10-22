export type SandboxFileType = "file" | "directory" | "symlink" | "other";

export type DockerSandboxWorkspace =
  | Readonly<{ type: "ephemeral" }>
  | Readonly<{ type: "docker-volume"; name: string }>;

export type DockerSandboxNetwork =
  | Readonly<{ mode: "none" }>
  | Readonly<{ mode: "bridge"; ports?: readonly number[] }>;

export type DockerSandboxState =
  | "running"
  | "stopping"
  | "stopped"
  | "destroying"
  | "destroyed"
  | "error";

export type DockerSandboxResources = Readonly<{
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

export type DockerSandboxSecurity = Readonly<{
  readonlyRootfs?: boolean;
  noNewPrivileges?: boolean;
  dropCapabilities?: readonly string[];
  addCapabilities?: readonly string[];
  seccompProfile?: Readonly<{
    type: "path";
    path: string;
  }>;
}>;

export type CreateDockerSandboxOptions = Readonly<{
  id?: string;
  image: string;
  workdir?: string;
  workspace: DockerSandboxWorkspace;
  network: DockerSandboxNetwork;
  /** Docker runtime used to run the container, as registered in the daemon
   *  (for example "runsc" for gVisor). The runtime must already be registered;
   *  createSandbox() fails with `runtime_not_found` otherwise. Omitted means
   *  the daemon default. resumeSandbox() keeps the container's runtime. */
  containerRuntime?: string;
  files?: Readonly<Record<string, string | Uint8Array>>;
  directories?: readonly string[];
  env?: Readonly<Record<string, string>>;
  user?: string;
  labels?: Readonly<Record<string, string>>;
  resources?: DockerSandboxResources;
  runtime?: SandboxRuntimeLimits;
  security?: DockerSandboxSecurity;
  abortSignal?: AbortSignal;
}>;

export type ResumeDockerSandboxOptions = Readonly<{
  id: string;
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxClientOptions = Readonly<{
  dockerPath?: string;
}>;

export type PullDockerImageOptions = Readonly<{
  image: string;
  abortSignal?: AbortSignal;
}>;

export type SandboxExecOptions = Readonly<{
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  input?: string | Uint8Array;
  /** Stable identity of a mutating call. Runtimes that support it execute the call once per id. */
  operationId?: string;
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
  /** Stable identity of a mutating call. Runtimes that support it execute the call once per id. */
  operationId?: string;
  abortSignal?: AbortSignal;
}>;

export type SandboxWriteTextFileOptions = Readonly<{
  path: string;
  text: string;
  /** Stable identity of a mutating call. Runtimes that support it execute the call once per id. */
  operationId?: string;
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

/**
 * A reachable sandbox port. Docker publishes ports on the host and reports where; a runtime with
 * no host-reachable endpoint omits `host` and `hostPort` and only confirms the port is listening.
 */
export type SandboxPortStatus = Readonly<{
  containerPort: number;
  protocol: "tcp";
  host?: string;
  hostPort?: number;
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
  /** Stable identity of a mutating call. Runtimes that support it execute the call once per id. */
  operationId?: string;
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
  /** Stable identity of a mutating call. Runtimes that support it execute the call once per id. */
  operationId?: string;
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
  waitForPort(options: SandboxWaitForPortOptions): Promise<SandboxPortStatus>;
}

export interface DockerSandboxRuntime extends SandboxRuntime {
  readonly provider: "docker";
  waitForPort(options: SandboxWaitForPortOptions): Promise<SandboxPublishedPort>;
}

export type DockerSandboxInspectionOptions = Readonly<{
  files?: boolean;
  ports?: boolean;
  processes?: boolean;
}>;

export type DockerSandboxInspector = Readonly<{
  id: string;
  provider: "docker";
  workdir: string;
  containerRuntime: string;
  listFiles?: DockerSandboxRuntime["listFiles"];
  readFile?: DockerSandboxRuntime["readFile"];
  publishedPorts?: readonly SandboxPublishedPort[];
  listProcesses?: DockerSandboxRuntime["listProcesses"];
  readProcessLogs?: DockerSandboxRuntime["readProcessLogs"];
}>;

export type StopDockerSandboxOptions = Readonly<{
  abortSignal?: AbortSignal;
}>;

export interface DockerSandbox extends AsyncDisposable {
  readonly id: string;
  readonly state: DockerSandboxState;
  readonly runtime: DockerSandboxRuntime;

  inspector(options: DockerSandboxInspectionOptions): DockerSandboxInspector;
  stop(options?: StopDockerSandboxOptions): Promise<void>;
  destroy(): Promise<void>;
}

export type SandboxToolName =
  | "exec_command"
  | "read_file"
  | "write_file"
  | "list_files"
  | "list_ports"
  | "start_process"
  | "list_processes"
  | "read_process_logs"
  | "stop_process"
  | "wait_for_port";

/**
 * List of known shell interpreters that can execute arbitrary commands via args.
 * These are blocked by default unless explicitly allowed.
 */
export const shellInterpreters = [
  "sh",
  "bash",
  "zsh",
  "ksh",
  "dash",
  "ash",
  "busybox",
  "fish",
  "csh",
  "tcsh",
] as const;

export type SandboxCommandPolicy =
  | Readonly<{ mode: "allow"; values: readonly string[]; allowShellInterpreters?: boolean }>
  | Readonly<{ mode: "block"; values: readonly string[] }>;

export type SandboxExecToolPolicy = Readonly<{
  commands?: SandboxCommandPolicy;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}>;

export type SandboxFileToolPolicy = Readonly<{
  maxBytes?: number;
}>;

export type SandboxReadFileToolPolicy = SandboxFileToolPolicy &
  Readonly<{
    defaultLineCount?: number;
    maxLineCount?: number;
  }>;

export type SandboxProcessToolPolicy = Readonly<{
  maxLogBytes?: number;
  defaultWaitTimeoutMs?: number;
  maxWaitTimeoutMs?: number;
  stopGracePeriodMs?: number;
}>;

export type CreateSandboxToolsOptions = Readonly<{
  sandbox: SandboxRuntime;
  tools: readonly [SandboxToolName, ...SandboxToolName[]];
  exec?: SandboxExecToolPolicy;
  readFile?: SandboxReadFileToolPolicy;
  writeFile?: SandboxFileToolPolicy;
  process?: SandboxProcessToolPolicy;
}>;

export type CreateDockerSandboxToolsOptions = Omit<CreateSandboxToolsOptions, "sandbox"> &
  Readonly<{ sandbox: DockerSandboxRuntime }>;

export type DockerSandboxFileType = SandboxFileType;
export type DockerSandboxExecOptions = SandboxExecOptions;
export type DockerSandboxExecResult = SandboxExecResult;
export type DockerSandboxExecStreamEvent = SandboxExecStreamEvent;
export type DockerSandboxReadFileOptions = SandboxReadFileOptions;
export type DockerSandboxReadTextFilePageOptions = SandboxReadTextFilePageOptions;
export type DockerSandboxTextFilePage = SandboxTextFilePage;
export type DockerSandboxWriteFileOptions = SandboxWriteFileOptions;
export type DockerSandboxWriteTextFileOptions = SandboxWriteTextFileOptions;
export type DockerSandboxListFilesOptions = SandboxListFilesOptions;
export type DockerSandboxFileEntry = SandboxFileEntry;
export type DockerSandboxPublishedPort = SandboxPublishedPort;
export type DockerSandboxWaitForPortOptions = SandboxWaitForPortOptions;
export type DockerSandboxProcessStartOptions = SandboxProcessStartOptions;
export type DockerSandboxProcessStatus = SandboxProcessStatus;
export type DockerSandboxProcessInfo = SandboxProcessInfo;
export type DockerSandboxListProcessesOptions = SandboxListProcessesOptions;
export type DockerSandboxReadProcessLogsOptions = SandboxReadProcessLogsOptions;
export type DockerSandboxProcessLogs = SandboxProcessLogs;
export type DockerSandboxStopProcessOptions = SandboxStopProcessOptions;
export type DockerSandboxToolName = SandboxToolName;
export type DockerSandboxCommandPolicy = SandboxCommandPolicy;
export type DockerSandboxExecToolPolicy = SandboxExecToolPolicy;
export type DockerSandboxFileToolPolicy = SandboxFileToolPolicy;
export type DockerSandboxReadFileToolPolicy = SandboxReadFileToolPolicy;
export type DockerSandboxProcessToolPolicy = SandboxProcessToolPolicy;
export type DockerSandboxRuntimeLimits = SandboxRuntimeLimits;
