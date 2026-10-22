import type {
  SandboxExecOptions,
  SandboxExecResult,
  SandboxExecStreamEvent,
  SandboxFileEntry,
  SandboxFileType,
  SandboxListFilesOptions,
  SandboxListProcessesOptions,
  SandboxProcessInfo,
  SandboxProcessLogs,
  SandboxProcessStartOptions,
  SandboxProcessStatus,
  SandboxPublishedPort,
  SandboxReadFileOptions,
  SandboxReadProcessLogsOptions,
  SandboxReadTextFilePageOptions,
  SandboxResources,
  SandboxRuntime,
  SandboxRuntimeLimits,
  SandboxState,
  SandboxStopProcessOptions,
  SandboxTextFilePage,
  SandboxWaitForPortOptions,
  SandboxWriteFileOptions,
  SandboxWriteTextFileOptions,
} from "./engine/types";

export type DockerSandboxFileType = SandboxFileType;

export type DockerSandboxWorkspace =
  | Readonly<{ type: "ephemeral" }>
  | Readonly<{ type: "docker-volume"; name: string }>;

export type DockerSandboxNetwork =
  | Readonly<{ mode: "none" }>
  | Readonly<{ mode: "bridge"; ports?: readonly number[] }>;

export type DockerSandboxState = SandboxState;

export type DockerSandboxResources = SandboxResources;

export type DockerSandboxRuntimeLimits = SandboxRuntimeLimits;

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

export interface DockerSandboxRuntime extends SandboxRuntime {
  readonly provider: "docker";
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

export type DockerSandboxCommandPolicy =
  | Readonly<{ mode: "allow"; values: readonly string[]; allowShellInterpreters?: boolean }>
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
