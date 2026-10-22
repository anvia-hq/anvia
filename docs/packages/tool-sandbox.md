# `@anvia/sandbox` guide

Docker-backed sandbox ownership and tools for Anvia applications.

```ts
import { createDockerSandboxTools, DockerSandboxClient } from "@anvia/sandbox";

const client = new DockerSandboxClient();
await client.pullImage({ image: "node:22-bookworm" });

await using sandbox = await client.createSandbox({
  image: "node:22-bookworm",
  workspace: { type: "ephemeral" },
  network: { mode: "none" },
});

const tools = createDockerSandboxTools({
  sandbox: sandbox.runtime,
  tools: ["exec_command", "read_file", "write_file", "list_files"],
});
```

`DockerSandboxClient` performs explicit infrastructure operations. Its constructor performs no I/O,
and `createSandbox()` and `resumeSandbox()` never pull images. `DockerSandbox` owns the container and,
for an ephemeral workspace, its Docker volume. Dispose it asynchronously or call `destroy()`.

`stop()` preserves the container and workspace. `resumeSandbox({ id })` creates a fresh live handle for
that container; workspace files persist, while the in-memory managed-process registry starts empty. A
caller-owned `{ type: "docker-volume", name }` workspace is never deleted by the sandbox.

Networking is explicit. Use `{ mode: "none" }` or `{ mode: "bridge", ports: [...] }`; published ports
bind only to `127.0.0.1`. Runtime methods use object arguments, propagate abort signals, and expose
command and process output as bytes. Tool wrappers decode UTF-8 strictly and return structured values.

`exec_command` and `start_process` accept complete shell command lines in `command`, including
pipes, redirects, and multiline scripts. When `args` is omitted and the command contains shell
syntax or whitespace, the tools use `/bin/bash -c` if `/bin/bash` is executable, otherwise `sh -c`.
A fixed, read-only probe checks availability once per live sandbox runtime handle; concurrent tools
share the result. Failed or timed-out probes reject the call and can be retried, rather than being
treated as absence of Bash. The CLI image builder includes Bash in its common apt packages.

For exact argv execution without shell parsing, provide the executable in `command` and its
arguments in `args` (even `args: []` opts out of automatic shell selection). Runtime methods
`sandbox.runtime.exec()` and `startProcess()` remain exact-argv APIs. The internal managed-process
launcher remains POSIX `sh`; the selected shell runs only the user command line.

Command policies check the selected executable using exact names: allow `/bin/bash` for automatic
Bash execution, or `sh` for the fallback, with `allowShellInterpreters: true`. A policy allowing only
`sh` rejects natural command lines when Bash is present; a policy rejection never triggers fallback.
The read-only availability probe is internal infrastructure and contains no caller input.
Natural command lines remain rejected with block-mode command policies, before any probe, because
arbitrary shell syntax cannot be checked safely against an executable block list. Use exact
`command` and `args` input in that configuration; policies do not inspect shell script contents.

Previously, natural command lines used `sh -c`. Callers relying on POSIX `sh` behavior can keep it
explicitly (and allow `sh` plus `allowShellInterpreters: true` when using an allow policy):

```ts
await execTool.call({ command: "sh", args: ["-c", "your POSIX shell script"] });
```

Changing the default shell can affect builtins such as `echo`, even in scripts that previously
succeeded. Install/remove shells before creating the live sandbox handle; cached detection does
not track changes to shell installation during that handle's lifetime.

File paths and command working directories passed to agent tools may be workspace-relative (for
example `notes/result.txt`) or absolute paths inside the sandbox workdir (for example
`/workspace/notes/result.txt` with the default workdir). Paths outside the sandbox workdir are
rejected.

File writes also reject symlinks in any destination path component, including dangling links,
with `invalid_path`. The runtime inspects the path before creating directories and again before
`docker cp`; a failed inspection command returns `docker_command_failed`. Images must provide
`sh`. Inspection and copy are separate operations, so a concurrently running container process
can still race these checks by replacing a path component between them.

With `exec.commands.mode: "allow"`, both `exec_command` and `start_process` reject known shell
executables by default, including path-qualified names such as `/bin/sh`. To permit an allowlisted
shell, set `exec.commands.allowShellInterpreters` to the boolean `true`. Omitted or `false` keeps the
guard enabled; non-boolean values such as `"false"` are rejected when creating tools. This guard
checks executable names only: allowlisted runtimes such as Node.js or Python can still launch other
commands, so the command policy does not restrict what those programs can execute.

`resources.sharedMemoryMb` maps to a private Docker `/dev/shm` size. A security configuration may use
explicit `dropCapabilities` and `addCapabilities` arrays, plus
`seccompProfile: { type: "path", path }` with an absolute host path. These options are used by
`@anvia/browser` to keep Chromium's own process sandbox enabled.

`createSandbox()` accepts `containerRuntime` — the runtime name registered in the Docker daemon (for
example `runsc` for gVisor). The runtime must already be registered (`runsc install` followed by a
daemon restart); creation fails with a `runtime_not_found` error otherwise. `resumeSandbox()` keeps
the container's original runtime. Under gVisor, workspace files persist through
`stop()`/`resumeSandbox()` because they live on a Docker volume, but changes to the container's
writable rootfs outside the workspace do not survive a resume, and `security.seccompProfile` is not
enforced the way it is on the default runtime because the gVisor sentry mediates application
syscalls itself.

Studio does not discover sandboxes through tool metadata. Register a read-only inspector explicitly:

```ts
const studio = new Studio([agent], {
  sandboxes: [
    {
      inspector: sandbox.inspector({ files: true, ports: true, processes: true }),
      agentIds: [agent.id],
      toolNames: tools.map((tool) => tool.name),
    },
  ],
});
```

The `anvia-sandbox create-image` CLI only builds images. It does not create, resume, stop, or destroy
sandboxes. Its `playwright` feature remains a general code-sandbox image; the visible Chromium/CDP/
noVNC appliance is source-controlled and owned by `@anvia/browser`.

## Remote sandboxes

`DockerSandboxClient` drives the local `docker` CLI, so the sandbox lives and dies with the host
running the agent. The remote runtime splits that apart. The **control plane** runs the agent and
its tools. A small **daemon** inside each sandbox connects _out_ to the control plane over a
WebSocket, executes operations locally, and owns process state and logs. Restarting the control
plane only means the daemons reconnect; their processes keep running.

Everything runs against the neutral `SandboxRuntime` interface (`provider: string`).
`DockerSandboxRuntime` extends it, and `createSandboxTools({ sandbox })` builds the same tools for
any runtime. `createDockerSandboxTools` is a wrapper around it. The remote pieces ship as subpath
exports so Docker-only applications do not load `ws`:

- `@anvia/sandbox/remote`: `RemoteSandboxHub` and `RemoteSandboxRuntime`.
- `@anvia/sandbox/daemon`: `SandboxDaemon`, for embedding the daemon in your own process.
- `anvia-sandbox-daemon`: the daemon as an executable.

### End to end

Control plane:

```ts
import { createSandboxTools } from "@anvia/sandbox";
import { RemoteSandboxHub } from "@anvia/sandbox/remote";

const hub = new RemoteSandboxHub({
  // Map a daemon's bearer token to the sandbox it belongs to, or return null to refuse it.
  authorize: async (token) => {
    const sandbox = await db.sandboxes.findByToken(token);
    return sandbox ? { sandboxId: sandbox.id } : null;
  },
  connectTimeoutMs: 30_000,
});
await hub.listen({ port: 8787, path: "/daemon" });

// Usable before the daemon has connected. Calls wait up to connectTimeoutMs for it.
const sandbox = hub.runtime("sbx_123", { workdir: "/workspace" });

const tools = createSandboxTools({
  sandbox,
  tools: ["exec_command", "read_file", "write_file", "list_files", "start_process"],
});
```

Inside the sandbox (however your infrastructure starts it):

```sh
ANVIA_CONTROL_URL=wss://agents.example.com/daemon \
ANVIA_SANDBOX_TOKEN=<the token authorize() recognises> \
ANVIA_SANDBOX_WORKDIR=/workspace \
npx anvia-sandbox-daemon
```

To attach the hub to a server you already run, call `hub.handleUpgrade(request, socket, head)` from
its `upgrade` event instead of `hub.listen()`. The daemon sends the token as an
`Authorization: Bearer` header, and the hub calls `authorize` before the upgrade completes, so a
refused daemon gets HTTP 401. Use `wss://`; the daemon warns when it is given an unencrypted URL
that is not loopback.

The hub does no lifecycle management. It never creates, stops, or destroys a sandbox, and it does
not issue tokens. `hub.connected()` and `hub.isConnected(id)` report which daemons are attached.

Daemon environment: `ANVIA_CONTROL_URL` and `ANVIA_SANDBOX_TOKEN` are required.
`ANVIA_SANDBOX_WORKDIR` defaults to the current directory, and `ANVIA_SANDBOX_STATE_DIR` (the
operation table) to a directory under the OS temp directory. Optional limits are
`ANVIA_SANDBOX_COMMAND_TIMEOUT_MS`, `ANVIA_SANDBOX_MAX_OUTPUT_BYTES`,
`ANVIA_SANDBOX_MAX_FILE_BYTES` and `ANVIA_SANDBOX_MAX_PROCESSES`, with the same defaults as Docker.
The daemon removes `ANVIA_SANDBOX_TOKEN` and `ANVIA_CONTROL_URL` from the environment of every
command and process it runs, so agent-run code cannot read its own credentials. Keep the state
directory outside the workdir.

### Behavior while disconnected

A call made while the daemon is disconnected waits up to `connectTimeoutMs` and then fails with
`sandbox_unavailable`. If the connection drops while a call is in flight:

- **Reads** (`readFile`, `listFiles`, `readProcessLogs`, `listProcesses`, `waitForPort`) are retried
  after the daemon reconnects.
- **Mutations** (`exec`, `execStream`, `writeFile`, `startProcess`, `stopProcess`) that carry an
  `operationId` are retried the same way.
- **Mutations without an `operationId`** fail with `sandbox_unavailable`, because they may already
  have run.

Reconnects use exponential backoff with jitter. Daemons keep running processes, logs and the
operation table across disconnects. If a second daemon connects for the same sandbox id, it
replaces the first; the displaced daemon stops reconnecting rather than evicting its replacement.

### Idempotent operations with @anvia/durable

`exec`, `writeFile`, `startProcess` and `stopProcess` accept an optional `operationId`. The daemon
runs each id once. A retry that arrives while the first attempt is still running joins it, and a
later retry gets the stored result. Only successful results are stored: a failed or cancelled
attempt can be retried for real. Reusing an id with different parameters fails with
`invalid_state`.

`createSandboxTools` passes `ToolCallContext.operationId` through, so a durable run's stable
operation key reaches the daemon. That makes the mutating tools safe to mark `idempotent` in the
durable registration's `toolRecovery`:

```ts
toolRecovery: {
  exec_command: "idempotent",
  write_file: "idempotent",
  start_process: "idempotent",
  stop_process: "idempotent",
},
```

The operation table lives on the daemon's disk and is bounded (1,024 operations by default, oldest
evicted first), so deduplication covers recent operations, not all history. An operation that was
evicted runs again if retried. Two exceptions apply:

- `execStream` deduplicates the final result only. A duplicate does not replay output events.
- A daemon that loses its state directory also loses its history.

Without `@anvia/durable`, pass your own `operationId` to the runtime methods to get the same
behavior.

### Differences from Docker

Remote and Docker share one conformance test suite, so file, exec, process, path-safety and limit
behavior match. Known differences:

- The sandbox is the machine the daemon runs on, not a container the library created, so there is
  no `publishedPorts` (it is always empty) and no host address for a port. `waitForPort` resolves
  once something accepts TCP connections on the sandbox's loopback interface, and returns
  `{ containerPort, protocol: "tcp" }` with no `host` or `hostPort`. For this reason the
  `wait_for_port` tool's `host` and `hostPort` output fields are optional; Docker still returns
  them.
- A missing command is reported as exit code 127 and a missing working directory as exit 126,
  rather than as a thrown error. Reading a missing file fails with `invalid_path`.
- Path checks use the real path: reading or listing through a symlink that resolves outside the
  workdir is rejected, and a write is rejected if any component is a symlink. These checks are
  best-effort, because a concurrently running process can swap a path component between inspection
  and use.
- Commands run on the daemon's host with the daemon's privileges. Isolation, resource limits and
  network policy are whatever the surrounding sandbox provides.
- Each file moves in one frame, base64 encoded, so files are bounded by `maxFileBytes` and the
  hub's `maxPayloadBytes` (64 MiB by default). The daemon supports POSIX hosts only.
- The runtime reports the daemon's workdir once it has connected; until then it uses the `workdir`
  passed to `hub.runtime()`, defaulting to `/workspace`.

### Protocol

One WebSocket carries versioned JSON frames (`PROTOCOL_VERSION`), validated with zod on both ends.
The daemon opens with `hello` (version and workdir) and the hub answers `welcome`; a version
mismatch closes the socket with code 1002. Requests are correlated by `requestId`. `execStream`
output arrives as ordered `stream` frames, and a gap in the sequence aborts the call. Aborting a
call sends `cancel`, which aborts the daemon-side work and kills the command's whole process group.
Failures arrive as typed `error` frames that map to the existing error codes, plus
`sandbox_unavailable` and `protocol`. Both sides send application-level pings and drop a peer that
is silent for three intervals.

A request that carries an `operationId` is not aborted when the connection drops. It finishes on
the daemon and its result waits for the retry. Anything else is aborted, since nobody can receive
its answer.

### Not included

Provider adapters (for example E2B or Kubernetes), snapshots, idle pause and wake, port tunnels, a
PTY, and routing a sandbox across several control-plane nodes are out of scope. The interfaces
leave room for them: a provider adapter would create sandboxes, hand each daemon a token and URL,
and call `hub.runtime(id)`; tunnels would populate `host` and `hostPort` in `waitForPort`'s result;
and multi-node routing would replace the hub's in-memory registry. Until then, run one hub per
control-plane process and point each sandbox's daemon at it.
