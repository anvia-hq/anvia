export type DockerSandboxFileType = "file" | "directory" | "symlink" | "other";

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

export type DockerSandboxRuntimeLimits = Readonly<{
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
  files?: Readonly<Record<string, string | Uint8Array>>;
  directories?: readonly string[];
  env?: Readonly<Record<string, string>>;
  user?: string;
  labels?: Readonly<Record<string, string>>;
  resources?: DockerSandboxResources;
  runtime?: DockerSandboxRuntimeLimits;
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

export type DockerSandboxExecOptions = Readonly<{
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  input?: string | Uint8Array;
  abortSignal?: AbortSignal;
}>;

type DockerSandboxExecResultBase = Readonly<{
  stdout: Uint8Array;
  stderr: Uint8Array;
  durationMs: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}>;

export type DockerSandboxExecResult =
  | (DockerSandboxExecResultBase & Readonly<{ status: "exited"; exitCode: number }>)
  | (DockerSandboxExecResultBase & Readonly<{ status: "timed_out" }>);

export type DockerSandboxExecStreamEvent =
  | Readonly<{ type: "stdout"; data: Uint8Array }>
  | Readonly<{ type: "stderr"; data: Uint8Array }>
  | Readonly<{ type: "result"; result: DockerSandboxExecResult }>;

export type DockerSandboxReadFileOptions = Readonly<{
  path: string;
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxReadTextFilePageOptions = DockerSandboxReadFileOptions &
  Readonly<{
    startLine?: number;
    lineCount?: number;
    maxBytes?: number;
  }>;

export type DockerSandboxTextFilePage = Readonly<{
  content: string;
  startLine: number;
  endLine: number | null;
  nextStartLine: number | null;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
}>;

export type DockerSandboxWriteFileOptions = Readonly<{
  path: string;
  data: Uint8Array;
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxWriteTextFileOptions = Readonly<{
  path: string;
  text: string;
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxListFilesOptions = Readonly<{
  path?: string;
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxFileEntry = Readonly<{
  path: string;
  type: DockerSandboxFileType;
  size?: number;
}>;

export type DockerSandboxPublishedPort = Readonly<{
  containerPort: number;
  host: "127.0.0.1";
  hostPort: number;
  protocol: "tcp";
}>;

export type DockerSandboxWaitForPortOptions = Readonly<{
  containerPort: number;
  timeoutMs?: number;
  intervalMs?: number;
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxProcessStartOptions = Readonly<{
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxProcessStatus = "running" | "exited" | "stopped";

export type DockerSandboxProcessInfo = Readonly<{
  id: string;
  command: string;
  args: readonly string[];
  cwd?: string;
  status: DockerSandboxProcessStatus;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
}>;

export type DockerSandboxListProcessesOptions = Readonly<{
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxReadProcessLogsOptions = Readonly<{
  processId: string;
  tailBytes?: number;
  abortSignal?: AbortSignal;
}>;

export type DockerSandboxProcessLogs = Readonly<{
  stdout: Uint8Array;
  stderr: Uint8Array;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}>;

export type DockerSandboxStopProcessOptions = Readonly<{
  processId: string;
  gracePeriodMs?: number;
  abortSignal?: AbortSignal;
}>;

export interface DockerSandboxRuntime {
  readonly id: string;
  readonly provider: "docker";
  readonly workdir: string;
  readonly publishedPorts: readonly DockerSandboxPublishedPort[];

  exec(options: DockerSandboxExecOptions): Promise<DockerSandboxExecResult>;
  execStream(options: DockerSandboxExecOptions): AsyncIterable<DockerSandboxExecStreamEvent>;
  readFile(options: DockerSandboxReadFileOptions): Promise<Uint8Array>;
  readTextFile(options: DockerSandboxReadFileOptions): Promise<string>;
  readTextFilePage(
    options: DockerSandboxReadTextFilePageOptions,
  ): Promise<DockerSandboxTextFilePage>;
  writeFile(options: DockerSandboxWriteFileOptions): Promise<void>;
  writeTextFile(options: DockerSandboxWriteTextFileOptions): Promise<void>;
  listFiles(options?: DockerSandboxListFilesOptions): Promise<readonly DockerSandboxFileEntry[]>;
  startProcess(options: DockerSandboxProcessStartOptions): Promise<DockerSandboxProcessInfo>;
  listProcesses(
    options?: DockerSandboxListProcessesOptions,
  ): Promise<readonly DockerSandboxProcessInfo[]>;
  readProcessLogs(options: DockerSandboxReadProcessLogsOptions): Promise<DockerSandboxProcessLogs>;
  stopProcess(options: DockerSandboxStopProcessOptions): Promise<DockerSandboxProcessInfo>;
  waitForPort(options: DockerSandboxWaitForPortOptions): Promise<DockerSandboxPublishedPort>;
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
  listFiles?: DockerSandboxRuntime["listFiles"];
  readFile?: DockerSandboxRuntime["readFile"];
  publishedPorts?: readonly DockerSandboxPublishedPort[];
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

export type DockerSandboxToolName =
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

export type DockerSandboxCommandPolicy =
  | Readonly<{ mode: "allow"; values: readonly string[] }>
  | Readonly<{ mode: "block"; values: readonly string[] }>;

export type DockerSandboxExecToolPolicy = Readonly<{
  commands?: DockerSandboxCommandPolicy;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}>;

export type DockerSandboxFileToolPolicy = Readonly<{
  maxBytes?: number;
}>;

export type DockerSandboxReadFileToolPolicy = DockerSandboxFileToolPolicy &
  Readonly<{
    defaultLineCount?: number;
    maxLineCount?: number;
  }>;

export type DockerSandboxProcessToolPolicy = Readonly<{
  maxLogBytes?: number;
  defaultWaitTimeoutMs?: number;
  maxWaitTimeoutMs?: number;
  stopGracePeriodMs?: number;
}>;

export type CreateDockerSandboxToolsOptions = Readonly<{
  sandbox: DockerSandboxRuntime;
  tools: readonly [DockerSandboxToolName, ...DockerSandboxToolName[]];
  exec?: DockerSandboxExecToolPolicy;
  readFile?: DockerSandboxReadFileToolPolicy;
  writeFile?: DockerSandboxFileToolPolicy;
  process?: DockerSandboxProcessToolPolicy;
}>;
