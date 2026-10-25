# @anvia/sandbox

## 1.3.1

### Patch Changes

- 28c06d0: Fix the hub's browser tunnel and desktop relays crashing the process on runtimes whose WebSocket
  cannot pause, such as Bun. The relay called `ws.pause()` and `ws.resume()`, which Bun's own
  WebSocket (substituted for the `ws` package) does not have, so the first message from a browser
  threw `TypeError: ws.resume is not a function` inside a promise callback and exited the process.
  The relay now asks once whether the socket can pause. Where it cannot, it closes a browser that has
  more than 4 MiB waiting to reach the service with code 1008 and an explicit reason, instead of
  buffering without end. Sockets that can pause behave as before. The other relays (terminals, the
  daemon link, pings and upgrades) were checked on Bun and need no change, and the Bun compatibility
  suite now runs a hub, daemon and browser relay on Bun.

## 1.3.0

### Minor Changes

- ba27f84: Add a provider-neutral `SandboxRuntime` interface and `createSandboxTools`. `DockerSandboxRuntime`
  now extends `SandboxRuntime`, and `createDockerSandboxTools` wraps `createSandboxTools` with
  identical tool names, schemas, policies, and outputs. Neutral `Sandbox*` option and policy types
  are exported; the `DockerSandbox*` names remain as aliases.
- ba27f84: Add a remote sandbox runtime. `RemoteSandboxHub` (`@anvia/sandbox/remote`) accepts outbound
  WebSocket connections from `anvia-sandbox-daemon` (or the embeddable `SandboxDaemon` from
  `@anvia/sandbox/daemon`), authorizes them with a caller-supplied `authorize(token)`, and returns a
  `SandboxRuntime` per sandbox through `hub.runtime(id)`. The daemon owns process state and logs, so a
  control-plane restart only needs to reconnect; calls wait up to `connectTimeoutMs` and then fail
  with the new `sandbox_unavailable` error code. `hub.forget(id)` releases the hub's per-sandbox
  records when a sandbox is destroyed.

  Mutating runtime methods (`exec`, `writeFile`, `writeTextFile`, `startProcess`, `stopProcess`)
  accept an optional `operationId`, which the daemon executes once through a bounded on-disk table.
  `createSandboxTools` forwards `ToolCallContext.operationId`, so those tools can be marked
  `idempotent` in `@anvia/durable`. `SandboxRuntime.waitForPort` now returns a `SandboxPortStatus`
  whose `host` and `hostPort` are optional (Docker still returns both), and the `wait_for_port` tool's
  `host` and `hostPort` output fields are optional to match. The daemon runs on POSIX hosts and adds
  `ws` as a dependency.

- df24baa: Tunnel bytes, such as a desktop's VNC stream, now travel between the daemon and the hub as binary
  WebSocket messages instead of base64 inside JSON, once both sides list the new `binary-data`
  capability in `hello` and `welcome`. A peer without it keeps using `tunnel.data` with base64, so
  mixed versions work and `PROTOCOL_VERSION` does not change. Acknowledgements, open and close, and all
  other frames stay JSON, terminal output is unchanged, and the browser relays forward the same bytes
  through the same RFB filter. `binaryData: false` on `RemoteSandboxHub` or `SandboxDaemon` switches it
  off for a proxy that mishandles binary messages.
- 6af11bf: Add `createDesktopTools({ sandbox })` for agents to see and drive a remote sandbox desktop:
  `desktop_screenshot`, `desktop_click`, `desktop_mouse_move`, `desktop_drag`, `desktop_scroll`,
  `desktop_type`, `desktop_key`, `desktop_cursor_position` and `desktop_wait`. Arguments follow
  Claude's computer-use tool (`coordinate`, `start_coordinate`, `text`, `scroll_direction`,
  `scroll_amount`), and coordinates are pixels of the screenshot the model was shown, which is scaled
  to fit Claude's image limits and translated back to display pixels with out-of-range points refused.

  `desktopToolRecovery` marks screenshots, the cursor position and waiting `safe`, and every input
  `idempotent`, since the run's `operationId` reaches the daemon. Inputs fail with `desktop_locked`
  while a person has taken control; looking never does.

  Input tools wait `settleMs` (300 ms by default) after acting, so the application can react before
  the next input arrives; without it, keystrokes sent right after a shortcut are lost by programs
  that are still focusing a field.

- b18f13e: The desktop now runs on TigerVNC's `Xvnc` when it is installed: the display and the VNC server in one
  process, told about changes instead of polling for them as x11vnc does, which gives a viewer lower
  latency and smoother updates (and keeps a continuously changing screen from starving the VNC
  server). Images that only have `Xvfb` and `x11vnc` keep working: the daemon falls back to that pair.
  `desktop: { backend: "auto" | "xvnc" | "xvfb" }` and `desktop.binaries.{ xvnc, vncconfig }` choose or
  locate them, and naming `xvfb` or `x11vnc` in `binaries` keeps the pair. On Xvnc the display starts
  at the configured size and grows up to `maxResolution`, a viewer cannot resize it, and the daemon
  runs `vncconfig -nowin` (when installed) so the clipboard syncs. The reference image installs
  `tigervnc-standalone-server` instead of `xvfb x11vnc`.
- 0434ea6: Add a desktop capability to remote sandboxes. `hub.desktop(sandboxId)` returns a `SandboxDesktop`
  with `screenshot` (optionally scaled), `act` (move, click, drag, scroll, type, key), `cursorPosition`,
  `resize`, `status`, and a control lock: `takeover` pauses the agent's inputs with a typed
  `desktop_locked` error until `release` or the lease runs out, while watching and screenshots are
  never blocked.

  The daemon runs an X server with a VNC server (loopback only, no password) and a window manager itself: lazily on
  first use, restarting what crashes, and advertising `desktop` only when the programs are installed.
  The window manager defaults to `openbox-session` (openbox, which also runs `~/.config/openbox/autostart`), else `openbox`. A reference Debian image with a themed desktop and dock, Chromium and tmux is in `images/desktop/`. Viewers reach VNC through
  a tunnel; `hub.handleDesktopUpgrade` and `authorizeDesktop` relay a browser's noVNC connection,
  filtering the RFB stream so read-only viewers, and viewers who are not the current holder, cannot
  send input, and offering a JSON control channel for taking over and releasing.

  `SandboxDaemon` gains `desktop: false | { resolution, maxResolution, display, vncPort, windowManager,
lock, ... }`. The new `desktop_locked` error code is added.

- b18f13e: Tunnels can ask for the `interactive` flow profile, `hub.tunnel(id).open(port, { profile:
"interactive" })`, for streams a person is watching, like a desktop's VNC. The terminal-sized
  defaults (10 ms batching, 16 KiB frames, a 256 KiB window) allow about 2.6 MB/s over a 100 ms link;
  the profile sends frames at once, 64 KiB at a time, with a 2 MiB window and a 4 MiB socket buffer,
  and sizes the hub's buffer, write window (1 MiB) and ack step (128 KiB) to match. `desktop.openViewer()`
  and the browser desktop relay use it. The profile is an optional string in `tunnel.open`, which a daemon that
  applied it echoes in `tunnel.opened`, so there is no protocol bump: a daemon without it uses its
  defaults and the hub does too until it is confirmed. `SandboxDaemon`'s
  `tunnel: { flowByPort }` sets limits for one port and wins over the profile.
- 94b3a88: Add interactive terminals to remote sandboxes. `hub.terminal(sandboxId)` returns a
  `SandboxTerminal` with `open`, `list` and `kill`; `open` gives a typed handle with `write`,
  `resize`, `close`, an ordered `output` iterable and an `exit` promise. The daemon runs each session
  in tmux (3.2+), where it persists across hub disconnects and daemon restarts, or falls back to a
  plain shell with a bounded scrollback ring. PTYs come from `node-pty`, an optional peer dependency
  the daemon image installs, so Docker-only users install no native code.

  Terminals are negotiated through an additive `capabilities` list in `hello` and `welcome` rather
  than a protocol bump, so mixed hub and daemon versions fail with the new `unsupported` error code
  instead of a protocol error. Output is batched, numbered and acknowledged per terminal, so a flood
  cannot delay `exec` calls or heartbeats and a stalled viewer cannot grow memory.

  `RemoteSandboxHub` also gains `handleTerminalUpgrade`, `authorizeTerminal`, `allowedOrigins` and
  `terminalTicket` for a browser relay that checks a short-lived ticket and the request Origin and
  enforces read-only viewers.

- 485a586: Add port tunnels to remote sandboxes. `hub.tunnel(sandboxId).open(port)` returns a duplex handle
  (`write`, an ordered `output` iterable, `close`, and an `exit` promise) that carries raw TCP to a
  service on the sandbox's own loopback. Only `127.0.0.1` and `::1` are reachable, enforced by the
  hub, the frame schema and the daemon, and `SandboxDaemon` accepts `tunnel: { allowedPorts,
maxTunnels }` or `tunnel: false`. Tunnels are negotiated through the `tunnel` capability, so mixed
  versions fail with `unsupported`.

  Flow control is shared with terminals (one stream channel on the daemon, one inbound stream on the
  hub) and runs in both directions, so a slow or stalled reader cannot grow memory and tunnel traffic
  cannot delay `exec` calls, terminals or heartbeats.

  `RemoteSandboxHub` also gains `handleTunnelUpgrade`, `authorizeTunnel`, `maxTunnelBufferBytes` and a
  `tunnelPath` listen option for a browser relay with the same ticket and Origin rules as the terminal
  relay. The shared helpers are exported as `relayTicket` and `originAllowed`; `terminalTicket` remains
  as an alias. An invalid `pty.open` or `tunnel.open` frame now fails the caller immediately instead of
  leaving it waiting.

## 1.2.2

### Patch Changes

- 227b29b: Reject sandbox file writes when the destination or any parent path component is a symlink,
  including dangling links. Inspect before creating parent directories and again before copying
  bytes, preventing existing links from redirecting either operation outside the workspace.

## 1.2.1

### Patch Changes

- 8b1bd1a: Update runtime dependencies to the latest compatible minor and patch releases.

## 1.2.0

### Minor Changes

- 39678a9: Use `/bin/bash -c` for natural command lines when Bash is available, falling back to `sh -c` only when `/bin/bash` is not executable. This fixes brace expansion and Bash conditionals on Debian images where `/bin/sh` is dash. Cache a bounded, read-only availability probe per live sandbox runtime, and give `start_process` the same command-line handling as `exec_command`.

  Policies still require explicit shell permission and check the selected executable: allow `/bin/bash` for automatic Bash selection and `sh` for fallback. A policy that permits only `sh` rejects automatic Bash selection; block-mode policies still reject natural command lines. Preserve POSIX behavior with explicit `{ command: "sh", args: ["-c", script] }`. Explicit argv and the low-level runtime APIs retain their existing behavior.

## 1.1.8

### Patch Changes

- a32e40c: Refresh package READMEs with concise product overviews, current quickstarts, and links to detailed guides. Publish the updated documentation on npm.

## 1.1.7

### Patch Changes

- 0805970: Keep sandbox secrets out of Docker error messages. `assertDockerCli` builds its failure
  message from the Docker argv, and `createSandbox()` passes sandbox `env` values as
  `--env KEY=VALUE` arguments, so a failed `docker run` used to throw a
  `DockerSandboxError` whose message contained every environment value in cleartext. Those
  messages are routinely logged, traced, and shown to agents. The message now redacts the
  value after the `KEY=` prefix (for example `--env OPENAI_API_KEY=<redacted>`) while
  keeping the variable name and the rest of the command readable. The same redaction covers
  `-e KEY=VALUE` so the helper stays safe if other callers adopt it.

## 1.1.6

### Patch Changes

- efa3ea0: Accept natural shell command lines in `exec_command`, support file listing in Alpine and other
  BusyBox-based images, and prevent false file-boundary errors from macOS temporary path aliases.

## 1.1.5

### Patch Changes

- c3b25dd: Fix the package-manager-symlinked CLI entry point and accept safe workspace-absolute paths in
  sandbox tool calls.

## 1.1.4

### Patch Changes

- 8a873c8: Update upstream runtime dependencies and align SDK, React, and schema dependencies across the workspace. Update the browser image and host Playwright pins together to 1.63.0. Schema peers now require Zod ^4.6.5 and, for core's optional Valibot adapter, @valibot/to-json-schema ^1.8.0.

## 1.1.3

### Patch Changes

- 0d9bce0: Declare compatible workspace peer ranges so additive internal dependency releases do not force major releases of dependents.
- ad94c5e: Block shell interpreters by default in allow-mode command policies. The sandbox
  `exec_command` tool now rejects common shell executables (`sh`, `bash`, `zsh`,
  `ksh`, `dash`, `ash`, `busybox`, `fish`, `csh`, `tcsh`) when the command policy
  uses `mode: "allow"`, preventing agents from bypassing command restrictions via
  shell arguments like `sh -c "arbitrary command"`. Set `allowShellInterpreters:
true` in the command policy to restore the previous behavior.

  The opt-in requires the boolean `true`; non-boolean values are rejected when
  creating tools, including strings such as `"false"`. This applies to both
  `exec_command` and `start_process`.

## 1.1.2

### Patch Changes

- b85e94e: Add a `containerRuntime` option to `DockerSandboxClient.createSandbox()` for running sandboxes on
  alternative Docker runtimes such as gVisor (`runsc`). Creation fails with the new
  `runtime_not_found` error code when the runtime is not registered in the daemon, and sandbox
  inspectors now expose the active `containerRuntime`.
- Updated dependencies [f998fd6]
  - @anvia/core@1.1.2

## 1.1.1

### Patch Changes

- f48bb95: Bump upstream runtime dependencies to their latest versions and align zod to 4.5.4 across all packages and workspaces.
- Updated dependencies [f48bb95]
  - @anvia/core@1.1.1

## 1.0.10

### Patch Changes

- Updated dependencies [2277090]
  - @anvia/core@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [68953da]
  - @anvia/core@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [18344a2]
  - @anvia/core@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [9e5e068]
  - @anvia/core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [32cffc0]
  - @anvia/core@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [c7fb0f8]
  - @anvia/core@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [7973ddc]
  - @anvia/core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [3113e9a]
  - @anvia/core@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [c7c45a9]
  - @anvia/core@1.0.2

## 1.0.1

### Patch Changes

- @anvia/core@1.0.1

## 1.0.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- f0ffa43: Add the explicit Docker-backed Chromium browser runtime, semantic browser tools, noVNC desktop,
  Studio's clean resizable Playground viewer, and a human-control lease. Add the shared-memory and seccomp
  options required to keep Chromium's process sandbox enabled, including explicit capability additions
  for its namespace sandbox.
- eaecb75: Replace stateful sandbox sessions with an explicit Docker client, owned sandbox handles, resumable
  containers, object-only byte-oriented runtime operations, structured opt-in tools, and explicit
  read-only Studio inspector registrations.
- 4ab25bb: Expose `new Agent(options)` with direct `generate()` and steerable `stream()` execution, add run IDs
  to agent responses and observer starts, remove the prompt-request API and request subpath, remove
  singular builder registrations, and remove agent event stores in favor of observability integrations.
  Unify direct model calls around input-first completion, image, speech, and transcription functions,
  share retry options across agents and model calls, internalize request builders, and rename the
  pipeline agent stage to `agent()`. Rename `createTool()` schema options from `input` and `output` to
  `inputSchema` and `outputSchema`. Remove `ToolSet`, `AgentBuilder.useToolSet()`, and dynamic/provider
  tool registration methods in favor of a single `tools` option that accepts executable tools,
  provider-native tools, and tool indexes. Move dynamic tool selection settings onto
  `createToolIndex()` and expose each agent's executable inventory through readonly `agent.tools`.
  Unify static documents and searchable context indexes under the `context` option, move retrieval
  settings onto `createContextIndex()`, and expose the declaration inventory through readonly
  `agent.context`. Replace controlling hooks on `new Agent()` with observational `lifecycle`
  callbacks, rename tool approval configuration to `requiresApproval`, and add resumable
  `approval_required` results and stream events through `agent.resume()`. Remove `AgentBuilder`, its
  legacy approval handlers, and the controlling hooks entrypoint; Studio keeps its question workflow
  through an internal runtime hook while bridging resumable approvals to its existing routes and events.
  Replace `PipelineBuilder` and its `build()` phase with an immutable, directly executable
  `new Pipeline({ id, inputSchema })` API while preserving typed fluent composition and graph
  inspection.
  Replace `ExtractorBuilder` with a focused `new Extractor({ model, outputSchema })` API that accepts
  text directly, uses call-level generation and retry options, and returns either parsed data or a
  detailed extraction result without exposing Agent, context, history, or builder configuration.
  Internalize the eval suite's metric factory type and consolidate direct completion and Agent request
  normalization behind one internal request factory, removing the final Core builder abstractions.
- Updated dependencies [4564d2f]
- Updated dependencies [9ae0893]
- Updated dependencies [07a1e6c]
- Updated dependencies [0292ede]
- Updated dependencies [007b132]
- Updated dependencies [c0c6cb8]
- Updated dependencies [a90416c]
- Updated dependencies [1dfb4f3]
- Updated dependencies [07a1e6c]
- Updated dependencies [8dc2dfb]
- Updated dependencies [6354116]
- Updated dependencies [475ae22]
- Updated dependencies [c7f4bbc]
- Updated dependencies [45882ab]
- Updated dependencies [9cb661c]
- Updated dependencies [1f6db5c]
- Updated dependencies [5ec61e3]
- Updated dependencies [5476f98]
- Updated dependencies [45882ab]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [0292ede]
- Updated dependencies [4ab25bb]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/core@1.0.0

## 1.0.0-rc.11

### Patch Changes

- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/core@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- Updated dependencies [ef7ad39]
- Updated dependencies [9b9fe04]
  - @anvia/core@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [c0c6cb8]
  - @anvia/core@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [8dc2dfb]
  - @anvia/core@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [6341fd8]
  - @anvia/core@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [706b321]
  - @anvia/core@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- Updated dependencies [e96d038]
- Updated dependencies [e96d038]
  - @anvia/core@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- f0ffa43: Add the explicit Docker-backed Chromium browser runtime, semantic browser tools, noVNC desktop,
  Studio's clean resizable Playground viewer, and a human-control lease. Add the shared-memory and seccomp
  options required to keep Chromium's process sandbox enabled, including explicit capability additions
  for its namespace sandbox.
- eaecb75: Replace stateful sandbox sessions with an explicit Docker client, owned sandbox handles, resumable
  containers, object-only byte-oriented runtime operations, structured opt-in tools, and explicit
  read-only Studio inspector registrations.
- Updated dependencies [475ae22]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- Updated dependencies [9ae0893]
- Updated dependencies [c7f4bbc]
- Updated dependencies [1f6db5c]
- Updated dependencies [5476f98]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/core@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @anvia/core@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- 4ab25bb: Expose `new Agent(options)` with direct `generate()` and steerable `stream()` execution, add run IDs
  to agent responses and observer starts, remove the prompt-request API and request subpath, remove
  singular builder registrations, and remove agent event stores in favor of observability integrations.
  Unify direct model calls around input-first completion, image, speech, and transcription functions,
  share retry options across agents and model calls, internalize request builders, and rename the
  pipeline agent stage to `agent()`. Rename `createTool()` schema options from `input` and `output` to
  `inputSchema` and `outputSchema`. Remove `ToolSet`, `AgentBuilder.useToolSet()`, and dynamic/provider
  tool registration methods in favor of a single `tools` option that accepts executable tools,
  provider-native tools, and tool indexes. Move dynamic tool selection settings onto
  `createToolIndex()` and expose each agent's executable inventory through readonly `agent.tools`.
  Unify static documents and searchable context indexes under the `context` option, move retrieval
  settings onto `createContextIndex()`, and expose the declaration inventory through readonly
  `agent.context`. Replace controlling hooks on `new Agent()` with observational `lifecycle`
  callbacks, rename tool approval configuration to `requiresApproval`, and add resumable
  `approval_required` results and stream events through `agent.resume()`. Remove `AgentBuilder`, its
  legacy approval handlers, and the controlling hooks entrypoint; Studio keeps its question workflow
  through an internal runtime hook while bridging resumable approvals to its existing routes and events.
  Replace `PipelineBuilder` and its `build()` phase with an immutable, directly executable
  `new Pipeline({ id, inputSchema })` API while preserving typed fluent composition and graph
  inspection.
  Replace `ExtractorBuilder` with a focused `new Extractor({ model, outputSchema })` API that accepts
  text directly, uses call-level generation and retry options, and returns either parsed data or a
  detailed extraction result without exposing Agent, context, history, or builder configuration.
  Internalize the eval suite's metric factory type and consolidate direct completion and Agent request
  normalization behind one internal request factory, removing the final Core builder abstractions.
- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0

## 0.6.0

### Minor Changes

- 8816b16: Add bounded line pagination to the `read_file` agent tool and Docker sandbox sessions. File reads
  now return continuation metadata and use safe default line and byte limits.

## 0.5.0

### Minor Changes

- 90ff39e: Add `pnpm dlx @anvia/sandbox create-image`, an interactive and scriptable CLI that generates and
  builds local Docker images composed from Node.js, Bun, Python, reporting, Playwright, and curated
  apt, npm, and uv package selections.

## 0.4.1

### Patch Changes

- 24d42ab: Automatically expose sandbox-backed agent workspaces in Studio through read-only APIs and a
  dedicated Sandboxes inspector. Studio servers can also leave SIGINT handling to the application or
  use the managed `serve(...)` lifecycle to await asynchronous resource cleanup.

## 0.4.0

### Minor Changes

- 535c04d: Add loopback-only Docker port publishing, managed long-running processes, readiness checks, and opt-in agent tools for application-proxied website previews.

## 0.3.7

### Patch Changes

- 433f642: Simplify optional object construction across runtime integrations without changing public behavior.

## 0.3.6

### Patch Changes

- 25388db: Publish the widened `@anvia/core` peer dependency range so current 0.x core releases satisfy the sandbox peer requirement.

## 0.3.5

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.3.4

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [369b6c4]
  - @anvia/core@0.6.3

## 0.3.2

### Patch Changes

- Updated dependencies [4806f3e]
  - @anvia/core@0.6.2

## 0.3.1

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.3.0

### Minor Changes

- 18403b7: Add sandbox V2 controls for persistent workspaces, lifecycle cleanup, streaming command execution, file-size limits, observability hooks, language presets, and model-facing tool policies.

## 0.2.2

### Patch Changes

- Updated dependencies [2d039f6]
  - @anvia/core@0.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

## 0.2.0

### Minor Changes

- 74797ba: Add a Docker-backed sandbox package for ephemeral agent workspaces.
