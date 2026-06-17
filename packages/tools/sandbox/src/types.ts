import type { AnyTool } from "@anvia/core/tool";

export type SandboxFileType = "file" | "directory" | "symlink" | "other";

export type SandboxNetworkMode = boolean | "none" | "host" | string;

export type SandboxWorkspaceOptions =
  | {
      mode?: "ephemeral";
    }
  | {
      mode: "persistent";
      id: string;
      destroyOnSessionDestroy?: boolean;
    };

export interface SandboxLifecycleOptions {
  ttlMs?: number;
  idleTimeoutMs?: number;
  autoDestroy?: boolean;
}

export interface Sandbox {
  readonly provider: string;

  createSession(options?: SandboxCreateSessionOptions): Promise<SandboxSession>;
}

export interface SandboxSession {
  readonly id: string;
  readonly provider: string;
  readonly workdir: string;

  exec(options: SandboxExecOptions): Promise<SandboxExecResult>;
  execStream(options: SandboxExecOptions): AsyncIterable<SandboxExecStreamEvent>;
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
  listFiles(path?: string): Promise<SandboxFileEntry[]>;
  destroy(): Promise<void>;
}

export interface SandboxCreateSessionOptions {
  id?: string;
  workspace?: SandboxWorkspaceOptions;
  manifest?: SandboxManifest;
  metadata?: Record<string, string>;
}

export interface SandboxManifest {
  files?: Record<string, string | Uint8Array>;
  directories?: string[];
  env?: Record<string, string>;
}

export interface SandboxLimits {
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxFileBytes?: number;
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
}

export interface SandboxExecOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  input?: string | Uint8Array;
  signal?: AbortSignal;
  onStdout?: (chunk: Uint8Array) => void;
  onStderr?: (chunk: Uint8Array) => void;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export type SandboxExecStreamEvent =
  | {
      type: "stdout";
      chunk: Uint8Array;
      text: string;
    }
  | {
      type: "stderr";
      chunk: Uint8Array;
      text: string;
    }
  | {
      type: "exit";
      result: SandboxExecResult;
    };

export interface SandboxFileEntry {
  path: string;
  type: SandboxFileType;
  size?: number;
}

export interface DockerSandboxSecurityOptions {
  readonlyRootfs?: boolean;
  noNewPrivileges?: boolean;
  dropCapabilities?: string[];
}

export interface DockerSandboxNetworkOptions {
  mode: SandboxNetworkMode;
}

export interface SandboxSessionEvent {
  sessionId: string;
  provider: string;
  workdir: string;
}

export interface SandboxExecEvent extends SandboxSessionEvent {
  command: string;
  args: string[];
  cwd?: string;
}

export interface SandboxExecEndEvent extends SandboxExecEvent {
  result: SandboxExecResult;
}

export interface SandboxFileWriteEvent extends SandboxSessionEvent {
  path: string;
  size: number;
}

export interface SandboxHooks {
  onSessionCreate?: (event: SandboxSessionEvent) => void | Promise<void>;
  onExecStart?: (event: SandboxExecEvent) => void | Promise<void>;
  onExecEnd?: (event: SandboxExecEndEvent) => void | Promise<void>;
  onFileWrite?: (event: SandboxFileWriteEvent) => void | Promise<void>;
  onDestroy?: (event: SandboxSessionEvent) => void | Promise<void>;
}

export interface DockerSandboxOptions {
  image?: string;
  pull?: "missing" | "always" | "never";
  workdir?: string;
  workspace?: SandboxWorkspaceOptions;
  lifecycle?: SandboxLifecycleOptions;
  network?: SandboxNetworkMode | DockerSandboxNetworkOptions;
  user?: string;
  dockerPath?: string;
  labels?: Record<string, string>;
  limits?: SandboxLimits;
  security?: DockerSandboxSecurityOptions;
  hooks?: SandboxHooks;
}

export interface SandboxToolsOptions {
  allow?: SandboxToolName[];
  include?: SandboxToolName[];
  execTimeoutMs?: number;
  exec?: SandboxExecToolPolicy;
  readFile?: SandboxFileToolPolicy;
  writeFile?: SandboxFileToolPolicy;
}

export type SandboxToolName = "exec_command" | "read_file" | "write_file" | "list_files";

export interface SandboxExecToolPolicy {
  allowedCommands?: string[];
  blockedCommands?: string[];
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}

export interface SandboxFileToolPolicy {
  maxBytes?: number;
}

export type SandboxToolsFactory = (
  session: SandboxSession,
  options?: SandboxToolsOptions,
) => AnyTool[];
