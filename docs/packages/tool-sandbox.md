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
The hub keeps a small record per sandbox id; call `hub.forget(id)` when your lifecycle code
destroys a sandbox so a long-lived hub does not accumulate them. It also disconnects that
sandbox's daemon.

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

The operation table is bounded (256 operations by default, oldest evicted first), so
deduplication covers recent operations, not all history. An operation that was evicted runs again
if retried. Exceptions and limits:

- `execStream` deduplicates the final result only. A duplicate does not replay output events.
- A daemon that loses its state directory also loses its history.
- `startProcess` and `stopProcess` results are kept in daemon memory only, because process state
  does not survive a daemon restart. They deduplicate across reconnects and hub restarts, but a
  retry after the daemon itself restarted runs again.
- Other results are written to the state directory as they are, including command output. Results
  larger than 256 KiB are not kept (`maxStoredResultBytes`): a retry of such an operation fails
  with `invalid_state` instead of running it a second time. The directory is created with owner-only
  permissions; point `ANVIA_SANDBOX_STATE_DIR` somewhere private if commands may print secrets.

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

### Terminals

A remote sandbox can also offer interactive terminals: a person (or your code) attaches to a
named session in the sandbox, types, resizes, and reattaches later with the scrollback intact.
Terminals are a separate capability, not part of `SandboxRuntime`, and only remote sandboxes have
them.

```ts
const terminal = hub.terminal("sandbox-1");
const handle = await terminal.open({ sessionName: "main", cols: 120, rows: 30 });

handle.write("npm test\n");
for await (const chunk of handle.output) process.stdout.write(chunk);
console.log(await handle.exit); // { reason: "exited", exitCode: 0 }

await terminal.list(); // [{ name: "main", attached: 1, persistent: true }]
await terminal.kill("main");
```

`open` attaches to the session named `sessionName`, creating it in the workdir (or `cwd`, relative
to it) if needed. Several handles can attach to one session and all see the same output. `close()`
detaches; the session keeps running until `kill` or until the sandbox stops. `output` is read once,
and `exit` never rejects. It reports `exited`, `closed`, `killed`, `error`, or `disconnected` (the
daemon link dropped; the tmux session itself is unaffected, so reopen it after the daemon is back).
Opening a terminal waits for a disconnected daemon like any other call, then fails with
`sandbox_unavailable`. A terminal is bound to one connection, so it is never retried across a
reconnect.

#### Image requirements

The daemon offers terminals only when it can load [`node-pty`](https://github.com/microsoft/node-pty).
It is an optional peer dependency, so Docker-only users never install native code; add it to the
daemon's image yourself. On Linux it compiles from source, which needs `python3`, `make` and `g++`
at install time.

```dockerfile
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends tmux python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anvia/sandbox node-pty
ENV NODE_PATH=/usr/local/lib/node_modules
CMD ["anvia-sandbox-daemon"]
```

With **tmux 3.2 or newer** on `PATH`, a session is a tmux session on a private socket and every
viewer is its own `tmux attach`, so sessions persist across hub disconnects and daemon restarts and
reattaching redraws the screen. The daemon sets `window-size latest` so viewers of different sizes
share one session, and read-only viewers attach with `read-only,ignore-size`. Splits and windows
made inside tmux work, as do its key bindings.

**Without tmux** the daemon falls back to one plain shell per session with a bounded scrollback
ring (`scrollbackBytes`, 256 KiB by default). That session survives hub disconnects but **not a
daemon restart**, and `list()` reports it with `persistent: false`. Set `ANVIA_SANDBOX_TERMINAL=0`
to switch terminals off, or `terminal: false` on `SandboxDaemon`.

The daemon advertises what it supports in `hello`, and the hub in `welcome`. A hub never sends a
terminal frame to a daemon that did not advertise `terminal`: `open`, `list` and `kill` fail with
the `unsupported` error code instead, and the rest of the link is unaffected. The same goes for a
daemon whose image lacks `node-pty`.

#### Flow control

Terminal output cannot starve `exec` calls or heartbeats on the shared socket. The daemon batches
output for about 10 ms into frames of at most 16 KiB, numbered per terminal. The consumer
acknowledges bytes as it reads them, and once 256 KiB are unacknowledged the daemon stops that
terminal: with tmux it pauses the attach PTY (tmux skips ahead for a slow client), and in the
fallback it drops the backlog and sends a reset plus a snapshot once the viewer catches up. It also
holds output back while the socket's send buffer is full. A handle that falls `maxTerminalBufferBytes`
(1 MiB) behind is cut off with `error`. A stalled viewer therefore slows only itself.

#### Browser terminals

`hub.handleTerminalUpgrade(request, socket, head)` accepts a browser's WebSocket and relays it to a
terminal. It is separate from the daemon upgrade path. Give the hub an `authorizeTerminal` function
and, behind a proxy, `allowedOrigins`:

```ts
const hub = new RemoteSandboxHub({
  authorize: (token) => lookupDaemonToken(token),
  allowedOrigins: ["https://app.example.com"],
  async authorizeTerminal(request) {
    const ticket = terminalTicket(request); // from ?ticket= or a WebSocket subprotocol
    const grant = ticket && (await redeemTicket(ticket)); // your store: single use, ~30 s
    return grant
      ? { sandboxId: grant.sandboxId, sessionName: grant.sessionName, readOnly: grant.readOnly }
      : null; // 401
  },
});
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url ?? "/", "http://x").pathname === "/terminal") {
    hub.handleTerminalUpgrade(request, socket, head);
  } else {
    hub.handleUpgrade(request, socket, head);
  }
});
```

(`hub.listen({ terminalPath: "/terminal" })` does the same routing for you.)

Browsers cannot send an `Authorization` header on a WebSocket, and a long-lived credential in a URL
would leak into logs, so the flow is:

1. The signed-in user asks your backend for access to a sandbox session.
2. Your backend checks permissions and mints a short-lived, single-use ticket bound to
   `{ sandboxId, sessionName, readOnly }`.
3. The browser opens the WebSocket offering the subprotocols `anvia.terminal.v1` and
   `anvia.ticket.<ticket>` (or, less ideally, `?ticket=<ticket>`).
4. `authorizeTerminal` redeems the ticket. A missing or refused ticket gets HTTP 401.

The hub checks `Origin` before it calls `authorizeTerminal`: it must be in `allowedOrigins`, or,
with no list, match the `Host` the browser connected to. Anything else gets 403. Requests with no
`Origin` (not a browser page) pass this check and still need a ticket.

Over the socket, the browser's first message must be `{ "type": "open", "cols": 80, "rows": 24 }`,
followed by `{ "type": "input", "data": "ls\n" }` and `{ "type": "resize", "cols": 100, "rows": 30 }`.
Terminal output comes back as binary frames; `{ "type": "ready" | "exit" | "error" }` arrive as
text. A `readOnly` grant receives output only: the relay drops its input and resize messages, and
the daemon also attaches it read-only.

#### End to end

**1. The control plane** runs the hub and mints tickets for your signed-in users:

```ts
import { randomBytes } from "node:crypto";
import { RemoteSandboxHub, terminalTicket } from "@anvia/sandbox/remote";

const daemonTokens = new Map([[process.env.DAEMON_TOKEN!, "sandbox-1"]]);
const tickets = new Map<
  string,
  { sandboxId: string; sessionName: string; readOnly: boolean; expires: number }
>();

/** Call this from an authenticated route, after checking the user may open this session. */
export function mintTerminalTicket(grant: {
  sandboxId: string;
  sessionName: string;
  readOnly: boolean;
}) {
  const ticket = randomBytes(24).toString("base64url"); // URL-safe, so it can ride as a subprotocol
  tickets.set(ticket, { ...grant, expires: Date.now() + 30_000 });
  return ticket;
}

const hub = new RemoteSandboxHub({
  authorize: (token) => {
    const sandboxId = daemonTokens.get(token);
    return sandboxId ? { sandboxId } : null;
  },
  allowedOrigins: ["http://localhost:5173"],
  authorizeTerminal(request) {
    const ticket = terminalTicket(request);
    const grant = ticket === undefined ? undefined : tickets.get(ticket);
    if (ticket !== undefined) tickets.delete(ticket); // single use
    return grant !== undefined && grant.expires > Date.now() ? grant : null;
  },
});
await hub.listen({ port: 8787, path: "/daemon", terminalPath: "/terminal" });
```

**2. The sandbox** is the image from [Image requirements](#image-requirements), started with the
daemon's credentials. Use `wss://` outside local development:

```sh
docker build -t my-sandbox .
docker run --rm \
  -e ANVIA_CONTROL_URL=ws://host.docker.internal:8787/daemon \
  -e ANVIA_SANDBOX_TOKEN="$DAEMON_TOKEN" \
  my-sandbox
```

**3. The browser** renders `SandboxTerminal` from `@anvia/react-ui/sandbox-terminal`
(see [the component docs](./react-ui.md#sandbox-terminal)) and asks your backend for a ticket on
every connection:

```tsx
import "@xterm/xterm/css/xterm.css";
import { SandboxTerminal } from "@anvia/react-ui/sandbox-terminal";

<div style={{ height: 420 }}>
  <SandboxTerminal
    url="ws://localhost:8787/terminal"
    ticket={async () => (await fetch("/api/terminal-ticket", { method: "POST" })).text()}
  />
</div>;
```

#### Not included

Agent-facing terminal tools (such as capturing a pane), recording and replay, audit logs of terminal
input, and terminals for the Docker runtime are out of scope. `DockerSandboxRuntime` does not
implement `SandboxTerminal`; `docker exec -it` is the Docker equivalent today.

### Tunnels

A tunnel is a raw TCP connection from the control plane to a service listening on the sandbox's own
loopback: a dev server, a database, or a VNC server. The sandbox needs no inbound port and no
published address; the bytes ride the daemon's existing WebSocket.

```ts
const tunnel = hub.tunnel("sandbox-1");
const handle = await tunnel.open(5432); // 127.0.0.1, then ::1

await handle.write(startupMessage);
for await (const chunk of handle.output) process(chunk);
console.log(await handle.exit); // { reason: "remote" }
```

`open(port, { host })` accepts only `127.0.0.1` and `::1`; omit `host` to try both. Any other host is
a `TypeError` in the hub, and the daemon's frame validation rejects it as well, so a tunnel can
never reach another machine or the sandbox's external interfaces. A port nothing listens on fails
with the `port` error code. `exit` reports `remote` (the service closed), `closed` (`close()`),
`error`, or `disconnected` (the daemon link dropped), and never rejects.

To restrict what tunnels may reach, give the daemon `tunnel: { allowedPorts: [3000, 5900] }`;
other ports fail with `port`. `maxTunnels` (default 64 per connection) bounds how many a hub may
hold open, and `tunnel: false` switches tunnels off. The daemon advertises `tunnel` in `hello`, and
a hub talking to a daemon without it gets `unsupported`.

Tunnels share the daemon link with `exec` calls, terminals and heartbeats, and use the same flow
control as terminals in both directions. Output is batched, numbered and acknowledged as the reader
consumes it, and the daemon stops reading from a service once 256 KiB are unacknowledged, so a
reader that is slow or has stopped never makes the daemon buffer more. `handle.write()` works the
same way in reverse: it waits while 256 KiB are unconsumed by the service, so an upload to a slow
service does not pile up in memory either. A handle that falls `maxTunnelBufferBytes` (1 MiB)
behind is cut off with `error`.

Those limits suit terminals. A window can carry at most its own size per round trip, so 256 KiB over
a 100 ms link is about 2.6 MB/s however fast the service is. For a stream a person is watching,
pass `profile: "interactive"` to `open`: no batching, 64 KiB frames, a 2 MiB window and a 4 MiB
socket buffer (about 20 MB/s at 100 ms), with a hub-side buffer, write window (1 MiB) and ack step
(128 KiB) to match. `desktop.openViewer()` asks for it. The profile travels as an optional string in
`tunnel.open`, so a daemon that predates it, or does not know the name, simply uses its defaults.
On the daemon, `tunnel: { flowByPort: { 5900: { highWaterBytes, frameBytes, batchMs,
socketBufferBytes } } }` sets limits for one port, and wins over the requested profile, which wins
over `tunnel.flow`.

#### Browser tunnels

`hub.handleTunnelUpgrade(request, socket, head)` relays a browser's WebSocket to a tunnel byte for
byte, in binary frames, which is the framing noVNC and websockify use. Give the hub
`authorizeTunnel`, which returns the sandbox and port a ticket grants, and, behind a proxy,
`allowedOrigins`. Tickets and the Origin check work exactly as they do for
[browser terminals](#browser-terminals): `relayTicket(request)` reads the ticket from the
`anvia.ticket.<ticket>` subprotocol or `?ticket=`, a foreign Origin gets 403 before the authorizer
runs, and a missing or refused ticket gets 401. (`terminalTicket` is the same function under its
earlier name.)

```ts
const hub = new RemoteSandboxHub({
  authorize: (token) => lookupDaemonToken(token),
  allowedOrigins: ["https://app.example.com"],
  async authorizeTunnel(request) {
    const grant = await redeemTicket(relayTicket(request)); // single use, ~30 s
    return grant ? { sandboxId: grant.sandboxId, port: grant.port } : null; // 401
  },
});
await hub.listen({ port: 8787, path: "/daemon", tunnelPath: "/tunnel" });
```

The browser offers the `anvia.tunnel.v1` or `binary` subprotocol (plus its ticket). If the tunnel
cannot be opened, the relay closes the socket with code 1011 and a reason that starts with the error
code, such as `port: ...` or `unsupported: ...`. A browser that sends faster than the service reads
is paused until the service catches up.

#### Not included

Preview URLs and domain routing for tunnelled services, tunnels to hosts other than the sandbox's
loopback, and UDP are out of scope. A tunnel is a connection you open on demand, not a published
address.

### Desktop

A remote sandbox can have a desktop: a virtual display that an agent can see and drive and that a
person can watch or take over. It is the remote-sandbox counterpart to `@anvia/browser`, which
drives Chromium in a local Docker container. Chromium is just a program on the desktop, so any
graphical application works, and nothing is specific to browsers.

```ts
const desktop = hub.desktop("sandbox-1");

const shot = await desktop.screenshot({ scale: 0.5 }); // { png, width, height, displayWidth, ... }
await desktop.act({ type: "click", x: 640, y: 400 });
await desktop.act({ type: "type", text: "hello" });
await desktop.act({ type: "key", keys: "ctrl+s" });
await desktop.resize(1920, 1080);
```

`act` takes `mouse_move`, `click` (with `button` and `count`), `drag`, `scroll`, `type` and `key`.
Coordinates are pixels of the current display; a point outside it, or an `x` without a `y`, is a
`RangeError` rather than a click somewhere unexpected. Inputs run one at a time. They accept an
`operationId`, like other mutating calls, so a retry does not click twice.

#### Image requirements

The daemon offers `desktop` only when it has an X server with a VNC server, `xdotool`, `xrandr` and
ImageMagick's `import`, and says what is missing in its log otherwise. The X server is either
**`Xvnc`** (TigerVNC's `tigervnc-standalone-server`: the display and the VNC server in one process,
which is told about changes instead of polling for them) or the older pair **`Xvfb` with `x11vnc`**.
The daemon uses `Xvnc` when it is installed and falls back to the pair, so images built for the pair
keep working; `desktop: { backend: "xvnc" | "xvfb" }`, or naming a program in `binaries`, picks one.
On `Xvnc` the daemon also runs `vncconfig -nowin` when it is installed, which is what syncs the
clipboard. A window manager is optional (`openbox-session`, which is openbox plus its autostart file,
is used if it is there). `packages/tool-sandbox/images/desktop/Dockerfile` is a reference image with
all of that plus fonts, a themed dock, Chromium, tmux, `node-pty` and the daemon. Maintainers can
publish it to `ghcr.io/anvia-hq/sandbox-desktop` (amd64 and arm64) with the "Sandbox desktop image"
workflow, which builds the daemon from the same commit. Until a tag is published, build it yourself:

```sh
docker build -t my-desktop-sandbox packages/tool-sandbox/images/desktop
docker run --rm -e ANVIA_CONTROL_URL=wss://hub.example.com/daemon \
  -e ANVIA_SANDBOX_TOKEN=... my-desktop-sandbox
```

Inside it, `anvia-chromium` starts Chromium on the desktop. Chromium's own sandbox needs user
namespaces, which Docker's default seccomp profile blocks, so the launcher starts it with
`--no-sandbox`: the container is already the isolation boundary. Set `ANVIA_CHROMIUM_SANDBOX=1` to
keep Chromium's sandbox, and run the container with a seccomp profile that allows user namespaces
(or `--cap-add SYS_ADMIN`). `@anvia/browser`'s seccomp profile is not carried over: it crashes
`runc` on current Docker releases. For another base image, install the same packages (`tigervnc-standalone-server xdotool
imagemagick x11-xserver-utils`, optionally `openbox`).

#### Starting, supervising, resizing

Nothing graphical runs until the desktop is first used: `screenshot`, `act`, `resize`, `start()` or
a viewer connecting starts it, and callers arriving together share one start. The daemon runs the X
server (Xvnc, or Xvfb with x11vnc), the window manager, and on Xvnc `vncconfig`, and restarts
whichever crashes, with backoff. The X server takes the others down with it, since they hold its
display, and comes back at the size it was left at. A call that
arrives while the desktop is restarting waits for it. After five quick crashes in a row it gives up
and `status()` reports `failed` with the reason, until the next call tries again.

`status()` reports `state` (`stopped`, `starting`, `running`, `restarting`, `failed`), the current
and maximum size, the display, and how many restarts there have been. The display starts at
1280x800 and can be resized, with windows staying open, up to `maxResolution` (3840x2160; Xvfb is
started that big, Xvnc grows to it). A viewer cannot resize the display itself. Configure all of
this with `desktop: { backend, resolution, maxResolution, display, vncPort, windowManager, lock }` on
`SandboxDaemon`, or `desktop: false` to turn it off.

#### Control

A person takes over with `desktop.takeover({ holder: "alice" })`. While they hold control, the
agent's `act` calls fail with the `desktop_locked` error code, which says who holds it; screenshots,
`cursorPosition` and everyone's ability to watch are unaffected. `release({ holder })` hands it
back. Set the daemon's `lock.waitForReleaseMs` to make agent inputs wait for a release before they
fail.

A hold is a lease (60 s by default) that its holder renews by calling `takeover` again. If the
holder disappears, the lease runs out and the agent can act again, so a closed tab cannot lock it
out for good. Another holder cannot take over, or release, someone else's hold; `release({ force:
true })` is the operator's override. The hold lives in the daemon, so it survives a hub restart.

#### Viewing in a browser

The daemon's VNC server listens on `127.0.0.1` with no password, so the only way to reach it is a
[tunnel](#tunnels); the daemon allows its port through even when it restricts tunnel ports.
`desktop.openViewer()` opens that tunnel, and `hub.handleDesktopUpgrade` relays a browser's noVNC
connection to it, with `authorizeDesktop` returning `{ sandboxId, readOnly?, holder? }`. Tickets,
Origin checks and status codes are the same as for [browser terminals](#browser-terminals), and
`hub.listen({ desktopPath: "/desktop" })` routes to it. No websockify runs in the sandbox. In React,
use [`<SandboxDesktop>`](./react-ui.md#sandbox-desktop).

```ts
authorizeDesktop(request) {
  const grant = redeemTicket(relayTicket(request));
  return grant ? { sandboxId: grant.sandboxId, readOnly: grant.readOnly, holder: grant.userId } : null;
},
```

Binary frames carry the VNC stream. The relay reads the client half of it and removes the messages
that would drive the desktop (keys, pointer, clipboard, and resize requests) for a `readOnly` viewer
and for any viewer who is not the current holder, so a read-only viewer cannot type even with a
modified client. Anything the relay cannot account for closes the connection.

Text frames are a small JSON control channel. The browser sends `{ "type": "takeover" }` or
`{ "type": "release" }`; the relay answers with `{ "type": "control", held, holder, expiresAt, you,
readOnly }` whenever control changes, and `{ "type": "error", code, message }` when a request
fails. The relay renews its viewer's hold while connected and releases it on disconnect.

Anyone who can run commands inside the sandbox can also connect to the VNC port directly. That is
the same access the sandbox already gives them, but it means the desktop is not a boundary against
code running in the sandbox.

#### Agent tools

`createDesktopTools({ sandbox })` gives an agent eyes and hands on the desktop:

```ts
import { createDesktopTools, desktopToolRecovery } from "@anvia/sandbox";

const tools = createDesktopTools({ sandbox: hub.desktop("sandbox-1") });
// desktop_screenshot, desktop_click, desktop_mouse_move, desktop_drag, desktop_scroll,
// desktop_type, desktop_key, desktop_cursor_position, desktop_wait
```

Pass `tools: ["desktop_screenshot", "desktop_cursor_position"]` to let an agent look but not touch.

The arguments follow Claude's computer-use tool, so a model can use them as it already knows
them: `coordinate: [x, y]`, `start_coordinate`, `text` for `type` and `key` (key names such as
`Return` or `ctrl+s`), `scroll_direction` and `scroll_amount`, and `click_count` with `button` for
the left, right, middle, double and triple clicks. `left_mouse_down`/`up`, `hold_key` and `zoom` are
not offered.

Coordinates are **pixels of the latest screenshot**, from its top-left corner. Claude downscales
images beyond about 1568 px on the long edge or 1.15 megapixels, which would make coordinates drift,
so `desktop_screenshot` scales the image to fit those limits first (`screenshot: { maxEdge,
maxPixels }` changes them) and the other tools translate points back to display pixels, aiming at
the centre of the pixel the model pointed at. A point outside the screenshot is refused with the
valid range before anything happens. A display that already fits is not scaled, and one that is
resized between calls is noticed, because each tool reads the current size.

Each input tool waits `settleMs` (300 ms by default; `0` turns it off) after acting before it
returns. A model can send several inputs in one turn, and a program that is still reacting to one
drops keystrokes that arrive too soon: Chromium's address bar loses the text typed right after
`ctrl+l`. The screenshot, cursor position and wait tools do not wait.

The tools are separate rather than one `computer` tool because durable recovery is decided per tool
name. `desktopToolRecovery` is the table to use in a durable registration: screenshots, the cursor
position and waiting are `safe` to repeat, and every input is `idempotent`, because the run's
`operationId` reaches the daemon, which performs each input once even if the call is retried:

```ts
toolRecovery: { ...desktopToolRecovery, exec_command: "idempotent" },
```

While a person has taken control, the input tools fail with the `desktop_locked` error code and a
message naming who holds it, which the model sees as a failed tool call; the screenshot and cursor
tools keep working so the agent can watch and wait.

#### Not included

Wayland and WebRTC streaming, audio, CDP-based browser automation tools, preview URLs and domain
routing, and desktops for the local Docker runtime are out of scope. `@anvia/browser`'s semantic
page snapshots and per-tab scheduling are not carried over; the agent works from screenshots and
input actions.

### Protocol

One WebSocket carries versioned JSON frames (`PROTOCOL_VERSION`), validated with zod on both ends,
and, once both peers agree (below), tunnel bytes as binary messages.
The daemon opens with `hello` (version and workdir) and the hub answers `welcome`; a version
mismatch closes the socket with code 1002. Requests are correlated by `requestId`. `execStream`
output arrives as ordered `stream` frames, and a gap in the sequence aborts the call. Aborting a
call sends `cancel`, which aborts the daemon-side work and kills the command's whole process group.
Failures arrive as typed `error` frames that map to the existing error codes, plus
`sandbox_unavailable` and `protocol`. Both sides send application-level pings and drop a peer that
is silent for three intervals.

Optional features are negotiated, not versioned: `hello` and `welcome` carry an optional
`capabilities` list (`terminal`, `terminal.tmux` when sessions persist, `tunnel`, `desktop`, and
`binary-data`). A peer that predates a
feature sends none, and zod ignores fields it does not know, so mixed versions keep working and
terminals simply report `unsupported`. `PROTOCOL_VERSION` only changes when an existing frame
changes meaning. Terminal traffic uses its own frames (`pty.open`, `pty.opened`, `pty.input`,
`pty.resize`, `pty.ack`, `pty.output`, `pty.exit`, `pty.close`) plus the ordinary request frames
`terminalList` and `terminalKill`. Tunnels have theirs (`tunnel.open`, `tunnel.opened`,
`tunnel.data`, `tunnel.ack`, `tunnel.close`), and both reuse one flow-controlled stream channel on
each side of the link. The desktop is plain request frames (`desktopStatus`, `desktopResize`,
`desktopScreenshot`, `desktopCursor`, `desktopAction`, `desktopControl`, `desktopTakeover`,
`desktopRelease`), with the VNC stream carried by a tunnel.

**Binary data.** A tunnel's bytes (a desktop's VNC stream, for one) are a third of the traffic that
matters over a slow link, and as JSON they cost a base64 encode and decode and a string copy at each
end. When both `hello` and `welcome` list `binary-data`, tunnel bytes in both directions travel as
binary WebSocket messages instead: `[kind: 1][idLength: 1][tunnelId][seq: uint32][payload]`, where
`kind` says which way the bytes go. Everything else, the acknowledgements and the open and close
frames included, stays JSON, and `tunnel.ack` counts the same raw bytes either way. Each side sends
binary only to a peer that said it can take it, and treats a binary message it did not agree to, or
one that does not parse, as a protocol error (the hub closes the socket with 1002; the daemon answers
with an `error` frame). A peer without it just keeps using `tunnel.data` with base64, so there is
no protocol bump. `binaryData: false` on `RemoteSandboxHub` or `SandboxDaemon` turns it off, for the
rare proxy that mishandles binary messages. Terminal output stays JSON. The browser relays were
already binary on the browser's side; they forward bytes unchanged either way, through the same RFB
filter, so read-only viewers and the control lock hold on a binary link.

A request that carries an `operationId` is not aborted when the connection drops. It finishes on
the daemon and its result waits for the retry. Anything else is aborted, since nobody can receive
its answer.

### Not included

Provider adapters (for example E2B or Kubernetes), snapshots, idle pause and wake, port tunnels,
and routing a sandbox across several control-plane nodes are out of scope. The interfaces
leave room for them: a provider adapter would create sandboxes, hand each daemon a token and URL,
and call `hub.runtime(id)`; tunnels would populate `host` and `hostPort` in `waitForPort`'s result;
and multi-node routing would replace the hub's in-memory registry. Until then, run one hub per
control-plane process and point each sandbox's daemon at it.
