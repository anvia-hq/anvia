---
title: "Sandbox"
description: "Docker-backed sandbox sessions and agent tool helpers from @anvia/sandbox."
section: packages
sidebar:
  group: "sandbox"
  order: 6
  label: "Sandbox"
---
Import from `@anvia/sandbox`.

## DockerSandbox

```ts
class DockerSandbox implements Sandbox {
  readonly provider: "docker";
  constructor(options?: DockerSandboxOptions);
  static node(options?: DockerSandboxOptions): DockerSandbox;
  static python(options?: DockerSandboxOptions): DockerSandbox;
  static deno(options?: DockerSandboxOptions): DockerSandbox;
  createSession(options?: DockerSandboxCreateSessionOptions): Promise<DockerSandboxSession>;
}
```

Purpose: create ephemeral Docker-backed workspace sessions for running untrusted or model-generated code outside the host process.

Return behavior: `createSession(...)` creates one container and one Docker volume mounted at the session workdir. Call `destroy()` on the returned `SandboxSession` to remove both resources.

Notable errors: throws `SandboxDockerUnavailableError` when the Docker CLI is missing, `SandboxDockerCommandError` when Docker setup fails, and `SandboxPathError` for unsafe manifest paths.

## Sandbox Interfaces

```ts
interface Sandbox {
  readonly provider: string;
  createSession(options?: SandboxCreateSessionOptions): Promise<SandboxSession>;
}

interface SandboxSession {
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
```

Purpose: provider-neutral contracts for sandbox clients and live workspace sessions.

Return behavior: file paths are sandbox-relative; absolute paths and traversal outside the workspace are rejected.

`DockerSandboxSession` adds published-port and managed-process capabilities without making them
required for other `SandboxSession` providers.

## Session Options

```ts
type SandboxCreateSessionOptions = {
  id?: string;
  workspace?: SandboxWorkspaceOptions;
  manifest?: SandboxManifest;
  metadata?: Record<string, string>;
};

type DockerSandboxCreateSessionOptions = SandboxCreateSessionOptions & {
  ports?: readonly number[];
};

type SandboxWorkspaceOptions =
  | { mode?: "ephemeral" }
  | {
      mode: "persistent";
      id: string;
      destroyOnSessionDestroy?: boolean;
    };

type SandboxManifest = {
  files?: Record<string, string | Uint8Array>;
  directories?: string[];
  env?: Record<string, string>;
};

type SandboxLimits = {
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxFileBytes?: number;
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
  maxProcesses?: number;
};

type SandboxLifecycleOptions = {
  ttlMs?: number;
  idleTimeoutMs?: number;
  autoDestroy?: boolean;
};
```

Purpose: seed files, directories, environment, metadata, workspace mode, lifecycle cleanup, and runtime limits for a sandbox session.

`ports` contains unique TCP ports from 1 through 65535. Published ports require `network: true`
or a bridge-capable custom network. Docker binds them to random ports on host address
`127.0.0.1`; the application remains responsible for any authenticated public proxy.

## Docker Options

```ts
type DockerSandboxOptions = {
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
};

type DockerSandboxSecurityOptions = {
  readonlyRootfs?: boolean;
  noNewPrivileges?: boolean;
  dropCapabilities?: string[];
};

type DockerSandboxNetworkOptions = {
  mode: SandboxNetworkMode;
};

type SandboxNetworkMode = boolean | "none" | "host" | string;
```

Defaults: `image` is `node:22-bookworm`, `pull` is `missing`, `workdir` is `/workspace`, network access is disabled, `noNewPrivileges` is enabled, and Docker capabilities are dropped with `["ALL"]`.

Static presets: `DockerSandbox.node(...)`, `DockerSandbox.python(...)`, and `DockerSandbox.deno(...)` create sandboxes with language-specific default images.

## Execution

```ts
type SandboxExecOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  input?: string | Uint8Array;
  signal?: AbortSignal;
  onStdout?: (chunk: Uint8Array) => void;
  onStderr?: (chunk: Uint8Array) => void;
};

type SandboxExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

type SandboxExecStreamEvent =
  | { type: "stdout"; chunk: Uint8Array; text: string }
  | { type: "stderr"; chunk: Uint8Array; text: string }
  | { type: "exit"; result: SandboxExecResult };
```

Return behavior: non-zero command exits are returned in `SandboxExecResult`; infrastructure failures throw. `execStream(...)` yields stdout and stderr chunks as they arrive, then yields one `exit` event with the final result.

## Files

```ts
type SandboxFileType = "file" | "directory" | "symlink" | "other";

type SandboxFileEntry = {
  path: string;
  type: SandboxFileType;
  size?: number;
};
```

Purpose: typed file-listing results from `SandboxSession.listFiles(...)`.

## Published ports and managed processes

```ts
interface SandboxPortSession extends SandboxSession {
  readonly publishedPorts: readonly SandboxPublishedPort[];
  waitForPort(
    containerPort: number,
    options?: SandboxWaitForPortOptions,
  ): Promise<SandboxPublishedPort>;
}

interface SandboxProcessSession extends SandboxSession {
  startProcess(options: SandboxProcessStartOptions): Promise<SandboxProcessInfo>;
  listProcesses(): Promise<SandboxProcessInfo[]>;
  readProcessLogs(
    processId: string,
    options?: SandboxProcessLogsOptions,
  ): Promise<SandboxProcessLogs>;
  stopProcess(
    processId: string,
    options?: SandboxProcessStopOptions,
  ): Promise<SandboxProcessInfo>;
}

interface DockerSandboxSession extends SandboxPortSession, SandboxProcessSession {}

type SandboxPublishedPort = {
  containerPort: number;
  host: "127.0.0.1";
  hostPort: number;
  protocol: "tcp";
};

type SandboxProcessStartOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

type SandboxProcessStatus = "running" | "exited" | "stopped";

type SandboxProcessInfo = {
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  status: SandboxProcessStatus;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
};

type SandboxProcessLogs = {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

type SandboxProcessLogsOptions = { tailBytes?: number };
type SandboxProcessStopOptions = { gracePeriodMs?: number };
type SandboxWaitForPortOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
};

function isSandboxPortSession(session: SandboxSession): session is SandboxPortSession;
function isSandboxProcessSession(session: SandboxSession): session is SandboxProcessSession;
```

`startProcess(...)` starts an arbitrary structured command and returns after launch. Output is
retained in a bounded tail buffer. `maxProcesses` caps concurrent processes and retained process
records; the oldest completed records are pruned when capacity is needed. `waitForPort(...)`
confirms that the pre-authorized port is listening on all container interfaces; web servers must
bind to `0.0.0.0`, not container localhost. Idle timeout, TTL, and explicit session destruction
still clean up managed processes. Managed commands should remain in the foreground rather than
daemonizing, so the session can track their exit status and stop them reliably.

## Agent Tools

```ts
function createSandboxTools(
  session: SandboxSession,
  options?: SandboxToolsOptions,
): AnyTool[];

type SandboxToolsOptions = {
  allow?: SandboxToolName[];
  include?: SandboxToolName[];
  execTimeoutMs?: number;
  exec?: SandboxExecToolPolicy;
  readFile?: SandboxFileToolPolicy;
  writeFile?: SandboxFileToolPolicy;
  process?: SandboxProcessToolPolicy;
};

type SandboxToolName =
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

type SandboxExecToolPolicy = {
  allowedCommands?: string[];
  blockedCommands?: string[];
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
};

type SandboxFileToolPolicy = {
  maxBytes?: number;
};

type SandboxProcessToolPolicy = {
  maxLogBytes?: number;
  defaultWaitTimeoutMs?: number;
  maxWaitTimeoutMs?: number;
  stopGracePeriodMs?: number;
};

type SandboxToolsFactory = (
  session: SandboxSession,
  options?: SandboxToolsOptions,
) => AnyTool[];
```

Purpose: expose a live sandbox session as Anvia tools. The default bundle remains `exec_command`,
`read_file`, `write_file`, and `list_files`. Published-port and managed-process tools are opt-in.
They use the existing executable allow/block policy plus `SandboxProcessToolPolicy` limits.

## Hooks

```ts
type SandboxHooks = {
  onSessionCreate?: (event: SandboxSessionEvent) => void | Promise<void>;
  onExecStart?: (event: SandboxExecEvent) => void | Promise<void>;
  onExecEnd?: (event: SandboxExecEndEvent) => void | Promise<void>;
  onFileWrite?: (event: SandboxFileWriteEvent) => void | Promise<void>;
  onDestroy?: (event: SandboxSessionEvent) => void | Promise<void>;
};

type SandboxSessionEvent = {
  sessionId: string;
  provider: string;
  workdir: string;
};

type SandboxExecEvent = SandboxSessionEvent & {
  command: string;
  args: string[];
  cwd?: string;
};

type SandboxExecEndEvent = SandboxExecEvent & {
  result: SandboxExecResult;
};

type SandboxFileWriteEvent = SandboxSessionEvent & {
  path: string;
  size: number;
};
```

Purpose: observe session creation, command execution, managed process start/exit, file writes, and
cleanup without exposing those details to the model. Managed processes emit `onExecStart` when
launched and `onExecEnd` when they exit or are stopped.

For workflow guidance, see [Sandbox](/docs/basics/sandbox-tools).

## Errors

```ts
class SandboxError extends Error {}
class SandboxDockerUnavailableError extends SandboxError {}
class SandboxDockerCommandError extends SandboxError {}
class SandboxSessionDestroyedError extends SandboxError {}
class SandboxPathError extends SandboxError {}
class SandboxTimeoutError extends SandboxError {}
class SandboxFileSizeError extends SandboxError {}
class SandboxToolPolicyError extends SandboxError {}
class SandboxPortError extends SandboxError {}
class SandboxProcessError extends SandboxError {}
```

Purpose: typed failures for Docker setup, path and port validation, managed processes, destroyed
sessions, file size limits, tool policy limits, and sandbox operations.
