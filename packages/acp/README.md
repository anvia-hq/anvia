# @anvia/acp

Agent-side [Agent Client Protocol](https://agentclientprotocol.com/libraries/typescript)
adapter for Anvia. Applications supply their own agents, models, tools, and credentials.

**Current status: ACP 11 persistent sessions.** The package supports stable v1 initialization,
no-op authentication, NDJSON transport, a dedicated launcher, and in-memory sessions with
multi-turn prompt execution. Text/resource references work by default; images are opt-in.
`session/update` streams assistant text and tool status with stable session-local IDs;
`session/prompt` settles once with a stop reason after updates finish. `session/cancel` aborts the active turn and settles it with `cancelled`. Approval and question suspensions resume inside the same prompt.
Editor-supplied stdio MCP servers connect per session; Streamable HTTP is opt-in.

## Launcher

```sh
pnpm add @anvia/acp @anvia/core
pnpm exec anvia-acp ./agent.mjs
```

The single argument is a trusted local module path, resolved against the launch directory.
Use compiled JavaScript (`.mjs`, or `.js` in an ESM project). TypeScript requires a caller-supplied
Node loader; the launcher does not transpile it or install dependencies.

Export a named `sessionFactory`, a default factory, or a named/default Anvia `Agent`:

```js
import { Agent } from "@anvia/core/agent";
import { model } from "./model.js"; // Your provider and credential configuration.

export function sessionFactory(context) {
  return {
    agent: new Agent({
      id: context.sessionId,
      model,
      mcpServers: context.mcpServers,
      tools: [...context.editorTools],
    }),
    // Optional: dispose() for session-owned resources.
  };
}
```

Factories are loaded and validated as functions at startup and called per `session/new`, load/resume and successful config rebuild,
never during `initialize`. Return a fresh text-output Agent without its own `memory` option;
the adapter owns bounded, session-local history. A directly exported agent is constructed during
module import and normalized to a single-use factory, preventing reuse across sessions.
Prefer a factory for multiple sessions. Named `sessionFactory` takes precedence over default
exports; a default export takes precedence over named `agent`.

The launcher reserves stdout for protocol traffic before importing the module. `console`
methods and `process.stdout.write` go to stderr, including startup diagnostics and help.
Application code must not bypass this with direct writes to file descriptor 1 or inherited
child stdout. Spawn tools with piped output or stderr explicitly. The launcher executes trusted
application code; it is not a sandbox.

No auth methods are advertised. Schema-valid `authenticate` requests return `{}` after
initialization. The module owns credential configuration; import errors produce a generic
stderr diagnostic and exit status 1 without printing the raw error or stack.

## Library

```ts
import { createAcpConnection } from "@anvia/acp";
import { serveStdio } from "@anvia/acp/stdio";
import { sessionFactory } from "./agent.js";

const connection = serveStdio({ sessionFactory });
await connection.closed;
// Or: await connection.close(); // Idempotent.

// For caller-owned Web byte streams:
// createAcpConnection({ sessionFactory, input, output });
```

`serveStdio` also accepts Node `input`/`output` streams. The library does not replace the global
console, attach process signal handlers, or run providers on import. Library hosts must route
their own logs to stderr and own shutdown. Closing cancels the input reader, aborts session work,
clears runtime caches and disposes bindings while retaining committed store records without closing the caller's output stream. `closed` resolves
after cleanup on EOF, explicit close, or transport failure. Library shutdown waits for cooperative
factories/runs/disposers; the launcher bounds its shutdown wait to five seconds.

Optional settings are `agentInfo: { name, version, title? }` and `maxMessageBytes` (10 MiB by
default). Oversized input closes the connection through the SDK's bounded NDJSON reader.
`initialize` always returns protocol version `1`, including when another version is requested,
as specified by [ACP version negotiation](https://agentclientprotocol.com/protocol/v1/initialization).
Disk persistence and HTTP MCP are disabled by default; legacy SSE is unsupported. Local/editor
filesystem and terminal tools are not installed by default. Unknown methods return `-32601`, invalid
params return `-32602`, malformed JSON returns `-32700`, and invalid envelopes return `-32600`.

## Sessions and content

After initialization, send `session/new` with `{ "cwd": "/absolute/workspace", "mcpServers": [] }`.
Use its `sessionId` in `session/prompt` with an ordered `prompt` array of content blocks. A new
prompt on the same session sees successful prior turns. Different sessions have independent
agents, histories and locks; overlapping prompts in one session fail with `data.kind: "session_busy"`
(`-32600`). Unknown sessions fail with `session_not_found` (`-32002`).

The cwd must exist and be a directory. Optional `workspaceRoots` restricts creation to canonical
paths inside those directories, including symlink checks. The factory receives the canonical
absolute cwd and immutable client capability/policy snapshots. Application tools should resolve
paths against `context.cwd`; the adapter never calls `process.chdir()`. These checks do not sandbox
application code. Editor filesystem and terminal tools also require explicit host opt-in.

Text becomes Anvia user text parts. Resource links become labelled references containing name,
URI and description; no URI is fetched. Set `images: true` on `serveStdio` or `createAcpConnection`
to accept base64 PNG, JPEG, GIF and WebP images. Every factory result must then have an
image-capable model. The launcher uses defaults; opt-in requires a library host. Images map to
Anvia image parts with their MIME type. Set `embeddedContext: true` to accept embedded text resources as labelled user context.
Their URI is a label, never fetched; binary resource blobs remain unsupported. Audio, disabled
embedded context, disabled images and unsupported MIME types fail with `unsupported_content` (`-32602`); malformed base64 fails with `invalid_content`.
Annotations and `_meta` never become model instructions or permission overrides.

Streaming models use one stream consumer per segment; completion-only models use `generate`.
Approval and supported question suspensions resume within the original prompt.
Successful completion maps to `end_turn`, output limits to `max_tokens`, exhausted agent turns
to `max_turn_requests`, and guardrail/filter refusals to `refusal`. Provider/factory errors expose
only safe kinds (`execution_failed` / `configuration_error`), never raw causes or credentials.

## Streaming and tool presentation

`text_delta` becomes `agent_message_chunk`. Reasoning stays private by default. A library host
can set `reasoning: true` to send plaintext/summary deltas as `agent_thought_chunk`; encrypted
or redacted reasoning and signatures are never forwarded. This setting applies to live streaming
models, not completion-only projection or future transcript replay.

Tool calls emit `tool_call` and `tool_call_update` with the same adapter-generated ID. IDs remain
unique across model generations and prompts even when a provider reuses its IDs. Calls start as
`pending`; results become `completed`, or `failed` for `execution-denied`, `error-text` and
`error-json`. Raw arguments, outputs and error details stay private. There is no inferred
`in_progress` update because a model's call event may precede approval or execution.

The default title is the tool name, kind is `other`, and locations are empty. Return a trusted
presentation callback from your session factory to customize complete calls:

```ts
import type { AcpSessionFactory } from "@anvia/acp";

export const sessionFactory: AcpSessionFactory = (context) => ({
  agent: createApplicationAgent(context), // Your application-owned constructor.
  toolPresentation(call) {
    if (call.toolName === "read_config") {
      return {
        title: "Read project configuration",
        kind: "read",
        locations: [{ path: "package.json", line: 1 }],
      };
    }
    return undefined;
  },
});
```

`AcpToolPresentation` is exported for typed callbacks. Paths resolve against the session cwd;
lines are one-based. Titles are limited to 200 characters with controls removed and an ellipsis
when truncated; at most 100 locations are shown. Invalid lines and paths containing controls
are omitted. Locations only
annotate the UI and grant no filesystem permission. Include only public metadata in the callback;
its errors are sanitized. Set `diffs: [{ path, oldText?, newText }]` for proposed edits. Omit
`oldText` when unknown; use `null` only for a known new file. Diffs appear in pending updates and
permission requests, not as a claim of completed execution. Up to 20 diffs and 1 MiB aggregate
old/new text are shown. Oversized or invalid diffs are omitted. Built-in editor writes provide
a proposed new-text diff and location automatically; other tools require explicit host metadata.
Set `text` for explicit display text in tool updates and permission requests; controls are removed.
Built-in editor terminals include the full sanitized command with JSON-quoted arguments where
needed and the resolved cwd in this text, plus a command title and cwd location.

The mapper awaits each update in order and reads the final result only after consuming the stream.
Generations that return text only in the final response emit it once from core's `turn_end`
response when output guardrails are absent. With enforced output guardrails, only core's safe
replacement deltas are used; completion-only text comes from the guarded final outcome. Already
streamed text is never replayed from the outcome. Completion-only agents project successful run
messages after execution, including assistant text and tool status, without prior history.
Nested agent events and provider-side tool artifacts are not projected.

Input/output guardrail blocks and provider content filtering settle with `refusal`. Core's public
streamed refusal message is shown, but internal guardrail reasons and decision metadata are omitted;
blocked outcome text is not replayed. Enforced output guardrails control buffering before this
adapter receives deltas. Already emitted text or executed effects cannot be retracted.

## Editor tools and backend selection

Use the library host to enable editor features (the dedicated launcher keeps conservative defaults):

```ts
serveStdio({
  editorTools: { readTextFile: true, writeTextFile: true, terminal: true },
  images: true,
  embeddedContext: true,
  sessionFactory: (context) => ({
    agent: new Agent({
      id: context.sessionId,
      model, // Host-owned, image-capable Anvia model.
      tools: context.editorTools,
      mcpServers: context.mcpServers,
    }),
  }),
});
```

`context.editorTools` contains `editor_read_text_file`, `editor_write_text_file`, and/or
`editor_run_terminal` only when both the host and corresponding client capability allow it.
The factory must attach those exact tool objects. All require once-only approval, including reads.
No denied or failed editor call falls back to the local filesystem, shell, or Docker.

File paths and optional terminal cwd resolve against the session cwd. Lexical containment and
existing ancestor symlinks are checked against workspace roots, including for new files. The
editor must enforce access-time policy too: an external editor operation cannot be made atomic
with this process's symlink check. Terminal approval authorizes arbitrary command execution;
a cwd restriction does not sandbox the command. Commands use explicit argv without an adapter
shell or inherited environment. Text reads/writes and retained terminal output are bounded to
1 MiB. Terminals return output, truncation and exit status; they are released after success or
failure, and killed then released on cancellation. Cleanup uses independent two-second signals.
A late terminal creation response is retained for cleanup; execution stays quarantined until it
settles. A disconnected editor cannot acknowledge cleanup, so release is best effort on disconnect.

Local tools and Docker tools remain application-owned Anvia tools. Register only the backend
chosen for the session; enforce roots and approvals in local tool implementations. A local factory
should close over `context.cwd` and resolve every relative path against it, never `process.cwd()`.
No adapter code starts Docker. For an application-owned Docker runtime, register tools from
`createDockerSandboxTools` and map presentation paths explicitly:

```ts
import { mapSandboxPath } from "@anvia/acp";
import { createDockerSandboxTools } from "@anvia/sandbox";

// Inside your factory, after obtaining a session-owned sandbox whose workspace
// you explicitly seeded/synchronized from context.cwd:
const mapping = { sandboxRoot: sandbox.runtime.workdir, hostRoot: context.cwd };
const tools = createDockerSandboxTools({ sandbox: sandbox.runtime, tools: ["read_file"] }).map(
  (tool) => Object.freeze({ ...tool, requiresApproval: true }),
);
return {
  agent: new Agent({ id: context.sessionId, model, tools, mcpServers: context.mcpServers }),
  readOnlyTools: ["read_file"],
  toolPresentation(call) {
    if (
      call.toolName !== "read_file" ||
      !call.input ||
      typeof call.input !== "object" ||
      !("path" in call.input) ||
      typeof call.input.path !== "string"
    )
      return undefined;
    return { kind: "read", locations: [{ path: mapSandboxPath(call.input.path, mapping) }] };
  },
  dispose: () => sandbox.destroy(),
};
```

The snippet assumes editor tools are disabled. Sandbox tool arguments stay in the sandbox's
POSIX namespace; never pass host paths into them. `mapSandboxPath` rejects escapes from the
specified sandbox root. It only maps display metadata: it does not mount, copy, synchronize or
write host files. The existing Docker backend uses ephemeral or named Docker volumes. If there
is no corresponding host file, omit its editor location rather than inventing a mapping. For
sandbox edit tools, use the same mapping for explicitly supplied `diffs` and `locations`.

## Config options and slash commands

```ts
serveStdio({
  models: [
    { value: "fast", name: "Fast" },
    { value: "thorough", name: "Thorough" },
  ],
  readOnlyMode: true,
  commands: [
    {
      name: "explain",
      description: "Explain a topic",
      inputHint: "topic",
      expand: (args) => `Explain this topic: ${args}`,
    },
  ],
  sessionFactory(context) {
    const readOnly = context.config.mode === "read-only";
    return {
      agent: new Agent({
        id: context.sessionId,
        model: models[context.config.model ?? "fast"], // Your host-owned model map.
        tools: readOnly ? readTools : allTools, // Your application tools.
        mcpServers: context.mcpServers,
      }),
      readOnlyTools: readTools.map((tool) => tool.name),
    };
  },
});
```

`session/new` returns `configOptions`. Mode defaults to `ask`; `read-only` is offered only with
`readOnlyMode: true`. Model choices come only from the host; the first is the default. The factory
maps `context.config.model` to its own model and credentials. No model selector is offered without
a host catalog. Legacy `session/set_mode` remains unsupported.

`session/set_config_option` validates the value, cancels an active turn and its pending approval,
waits for execution/terminal cleanup, then calls the factory with a new immutable context. New
prompts and overlapping config changes fail with `session_busy` during rebuild. Invalid values
leave the current turn untouched. A failed rebuild retains the previous agent/config/history;
a successful rebuild swaps atomically, disposes the old binding, and emits `config_option_update`.
If disposal fails after the swap, the session is disabled instead of restoring a disposed agent.
MCP connections and successful history survive config changes; no old continuation is reused.
Disposers must release binding-owned resources only, not context-owned MCP clients.

Read-only mode supplies only enabled editor reads and no editor MCP tools. Every other tool in
the new agent must be listed in `readOnlyTools`; unknown tools reject the rebuild. Existing approval
requirements still apply. This is a host classification contract: the host must exclude dynamic
write paths, nested agents with effects, provider-side tools and middleware that adds effects before
enabling read-only mode. It is not an operating-system sandbox.

Commands are announced through `available_commands_update` after session creation. A sole text
block `/name arguments` invokes the registered synchronous, pure prompt expansion inside the
prompt lock. Unknown commands and mixed-content prompts remain ordinary user input. Both original
and expanded prompts obey normal limits. No built-in shell or configuration command is installed.

## Cancellation

Send a `session/cancel` notification with the session ID to stop an active prompt. The adapter
aborts the stream and the signal passed to the provider and local/MCP tools, invalidates pending
callbacks, and responds to the original `session/prompt` once with `stopReason: "cancelled"`.
Core `AgentRunCancelledError` is also normalized to this result. Idle and unknown-session cancels
are no-ops. `$/cancel_request` is separate and does not cancel a session turn.

Updates already handed to the transport drain before the response; subsequent updates and late
callback replies are discarded. Cancelled turns do not enter history, and the session lifetime
signal stays live. If caller code ignores abort, the prompt still settles, but the session returns
`session_busy` until that execution finishes. Resource disposal waits for execution too; the
launcher retains its bounded shutdown timeout. Cancellation cannot undo effects already started.
Tools should honor their `ToolCallContext.abortSignal` and pass it through to external operations.

Cancellation tests use real Anvia runs, MCP subprocesses, pending permissions, and v1 byte streams;
they do not claim real editor compatibility.

## Editor-supplied MCP servers

Pass editor declarations in `session/new.mcpServers`. Stdio entries use `name`, `command`,
`args` and `env: [{ name, value }]`. The adapter starts each server without a shell, in the
canonical session cwd, with piped protocol stdout and inherited stderr. The SDK inherits only
its platform environment allowlist (on Unix: `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`),
plus the explicitly supplied values. Provider credentials are not inherited implicitly. This
is privileged process launch, not a sandbox; supply trusted declarations only.

Return an Agent constructed with `mcpServers: context.mcpServers`, as in the factory example.
Dropping servers, replacing their tools, or stripping approval wrappers fails session creation.
All editor MCP tools require once-only approval, including tools claiming to be read-only.
No remote annotations grant permission. Tool names are `mcp_<first 16 hex digits of SHA-256(server name)>_<remote name>`;
prefixes are stable across order and sessions. Duplicate server names, duplicate remote names,
prefix collisions, and collisions with application tools fail setup rather than shadowing tools.

All declarations are validated before any server connects. Duplicate environment names (case-insensitive
on Windows), duplicate header names (always case-insensitive), invalid env/header entries and
transport-owned headers are rejected. Setup allows at most 32 servers and discovers at most
256 tools / 1 MiB of tool definitions per server. Connections use `versionNegotiation: { mode: "auto" }`:
modern discovery falls back to the legacy handshake. The SDK uses a disposable stdio probe process, then starts a separate session process;
server startup must tolerate this. The standalone `@anvia/mcp` default remains pinned.

Each session owns independent connections. Partial connection, discovery, or factory failure
closes acquired clients. Closing the session/ACP connection aborts setup and prompts, waits for
active execution, and attempts both MCP cleanup and the application's disposer even if one fails.
The MCP HTTP session DELETE is best effort and bounded to two seconds. `session/close` releases
runtime resources while retaining history. Configuration, credentials, and raw MCP errors are
omitted from ACP error responses.

Library hosts can restrict declarations and enable HTTP:

```ts
const connection = serveStdio({
  sessionFactory,
  mcp: {
    http: true,
    authorizeServer: (server, { cwd, signal }) => {
      signal.throwIfAborted();
      return cwd === "/work/project" && server.name === "editor";
    },
    trustedHttpEndpoints: [{ url: "http://localhost:3000/mcp", addresses: ["127.0.0.1", "::1"] }],
  },
});
```

HTTP declarations use `type: "http"`, `name`, `url`, and `headers: [{ name, value }]`.
`mcp.http: true` advertises the tested Streamable HTTP capability. Public URLs use strict SSRF
protection. Private access requires an exact host-configured URL and approved IP literals;
connections pin those addresses instead of trusting DNS changes. Only that URL receives the
exception. Other paths, ports, endpoints and OAuth URLs retain strict protection. Endpoint
redirects fail; configured headers never follow them. Loopback, RFC1918 and IPv6 ULA addresses
are supported; cloud metadata, link-local, mapped IPv6 and other reserved addresses remain blocked.
The editor cannot expand trust via declarations or `_meta`. Legacy SSE and ACP-proxied MCP
remain unsupported. Use the library entrypoint for host policy options; the dedicated launcher
uses defaults. The default `authorizeServer` permits validated declarations from the local editor.

## Approvals and questions

Tools with `requiresApproval` suspend until the editor answers `session/request_permission`.
Only `allow_once` and `reject_once` are offered. Allow resumes the tool; rejection resumes with
`approved: false`, letting the model handle the denied result. Unknown or malformed option IDs,
missing outcomes and RPC failures also reject. A cancelled outcome ends the prompt as `cancelled`.
Late replies after cancellation or disconnect cannot resume a continuation. No grants persist.

Permission dialogs use the same tool ID, title, kind and locations as tool updates. Raw arguments,
approval reasons and continuation state remain private. Use `toolPresentation` to supply the public
information needed to make a permission decision.

Question tools use form `elicitation/create` when `clientCapabilities.elicitation.form` is explicitly
present and non-null. Choices become titled enums; free/custom answers become strings. Every answer
is validated against the original question. Decline/cancel ends the turn as `cancelled`; invalid or
failed replies return `invalid_interaction_response`. Clients without form support receive
`unsupported_interaction`. No answer is fabricated or collected from stdin. Use question tools for
non-sensitive information only; this adapter does not implement URL elicitation for credentials.

A factory may return `turnBudget` alongside its agent:

```ts
return {
  agent,
  turnBudget: {
    maxModelCalls: 10,
    maxDurationMs: 5 * 60_000,
    maxCost: 1, // Units defined by your estimator, for example USD.
    estimateCost: (usage) => priceUsage(usage), // Your model pricing function.
  },
};
```

All limits span the entire prompt, including continuation segments. Logical model generation
requests default to `agent.defaultMaxTurns + 1` (normally 21); `maxModelCalls` can lower that ceiling.
Provider retries/structured-output repair attempts remain controlled by the agent's retry policy.
A resumed tool can finish after the last allowed generation, but no further generation starts.

Time and cost limits are optional. The one deadline includes time waiting for permission or answers.
Cost uses cumulative core usage across segments, including reported retry usage, and a host-supplied
`estimateCost` callback. It is checked after each generation and before resumption; it cannot prevent
that generation's charges or undo effects already started. Exhaustion returns `max_turn_requests`,
keeps prior history, and invalidates pending requests. Deadline expiry aborts execution; an
uncooperative provider/tool keeps the session busy until it finishes, as with cancellation.

Only public Anvia continuation types are used. Intermediate messages are stored privately and
committed once after the whole turn succeeds; text and tool calls are not replayed at resumption.

## Session storage and restore

The default `InMemoryAcpSessionStore` retains completed sessions for the connection lifetime,
including after `session/close`. Supply `sessionStore` to share records across sequential
connections or persist them across process restarts:

```ts
import { FileAcpSessionStore } from "@anvia/acp";
import { serveStdio } from "@anvia/acp/stdio";
import { sessionFactory } from "./agent.js";

const connection = serveStdio({
  sessionFactory,
  sessionStore: new FileAcpSessionStore("/absolute/private-app-data/acp-sessions.json"),
});
await connection.closed;
```

Use a library host for this option; the dedicated launcher continues to use in-memory defaults.
The host must keep logs on stderr. The file store serializes writes through one instance and
atomically replaces a JSON snapshot (0600 files, 0700 newly created directories). It reads and
rewrites the whole snapshot, so use a custom database-backed `AcpSessionStore` for large histories.
Use one active connection per store; concurrent processes/instances need host-managed exclusive
ownership. This store does not provide distributed locks, encryption, power-loss durability,
retention or backup deletion. Keep its path outside editor-controlled workspaces. Private model
history may contain sensitive tool output and provider reasoning/signatures.

`AcpSessionStore` is separate from core's `MemoryStore`: it stores a versioned session record
with canonical cwd, title, timestamps, config, the tool presentation ID counter, private model
messages and an allowlisted display transcript. `get` returns `undefined` only for an absent
session; an existing empty session is valid. `put` must atomically replace the entire record and
leave the old record intact on rejection. Return detached snapshots. Optional `list` and `delete`
methods control their advertised capabilities. Custom stores must apply workspace filters before
pagination and scope data to the host's user; ACP authentication remains a no-op.

- `session/load` restores through a fresh factory binding and replays committed original user
  content, visible assistant text and sanitized tool presentation before responding. It never
  executes historical tools or regenerates model output. Clients should replace the displayed
  transcript for a load; v1 replay is a complete history, not an append to an existing view.
- `session/resume` restores the same context without replay. Load/resume accept idle active or
  closed sessions, require matching canonical cwd and current host config/workspace policy, and
  reconnect only the newly supplied MCP declarations. Active turns, config rebuilds and concurrent
  lifecycle operations return `session_busy`. Config and command availability are returned/refreshed.
- `session/list` returns metadata only, optionally filtered by canonical `cwd` and always by host
  workspace roots. Pages contain at most 50 records in session-ID order; pass `nextCursor` back as
  `cursor` with the same filter. Cursors survive restart and deletion of earlier records. This is
  keyset pagination, not a snapshot: newly inserted IDs before a cursor require a fresh listing.
- `session/close` cancels ongoing work, waits for owned execution and disposes runtime resources.
  Committed data stays loadable/listed. Closing an already-closed existing record succeeds.
- `session/delete` closes active work and removes the record, its private history and its transcript.
  Repeated/unknown deletes succeed. A deleted session cannot be loaded or resumed.

Only completed turns commit; interrupted turns, pending approvals and continuations are not
execution checkpoints. Restoring cannot undo side effects from a turn interrupted before commit.
Starting an atomic store write is the completion boundary: a later cancellation cannot abandon it.
A failed write reports an error and preserves prior history/config, although live output may already
have been displayed. Replay excludes all reasoning (even live opt-in plaintext), system prompts,
provider signatures, raw arguments/results and private slash-command expansions. Explicit trusted
host presentation text/diffs and original user content remain visible. Model history is never used
as a fallback transcript. Each history and transcript independently obeys `maxHistoryBytes`.
Replay retains presentation `text`, including terminal command/argv/cwd details, without exposing
raw terminal output. Stored tool IDs replay unchanged; newly allocated IDs include a runtime
namespace so cards from uncommitted turns cannot collide after silent resume. IDs are opaque.
Malformed known transcript fields reject restore before any history is sent.

The default store implements and advertises load, resume, list, close and delete. Disk persistence
is not implied by these capabilities. See [DESIGN.md](./DESIGN.md) for proposed decisions and
[test/CONFORMANCE.md](./test/CONFORMANCE.md) for automated coverage and the GUI follow-up checklist.

## Resource bounds

Configure `limits` on the library host. Every value must be a positive safe integer.

| Option               | Default | Scope                                                       |
| -------------------- | ------- | ----------------------------------------------------------- |
| `maxSessions`        | 32      | Connection, including in-progress factories                 |
| `maxPromptBytes`     | 10 MiB  | Aggregate text and encoded-image bytes per prompt           |
| `maxTextBytes`       | 1 MiB   | UTF-8 text, including rendered resource references          |
| `maxImageBytes`      | 5 MiB   | Decoded bytes per image                                     |
| `maxContentBlocks`   | 256     | Blocks per prompt                                           |
| `maxHistoryBytes`    | 16 MiB  | Private history and replay transcript (each, per session)   |
| `maxHistoryMessages` | 1,000   | Private history messages per session                        |
| `maxPendingRequests` | 16      | Outstanding permission/question/editor requests per session |

Limit violations return `resource_limit` (`-32602`). The separate `maxMessageBytes` wire limit
includes metadata and closes the connection on overflow. History uses an adapter-owned in-memory
`MemoryStore`, with atomic completed-turn appends. It does not silently truncate or evict messages.
A response that exceeds the history budget fails the prompt, preserving prior history; application
effects that already ran cannot be undone. A prompt that already exceeds the history budget is
rejected before execution. Failed, blocked, suspended and exhausted runs preserve prior history only.
Provider/tool transient allocations are not bounded by the stored-history budget.

`maxSessions` bounds active sessions and factories. Use `session/close` to release capacity.
Stored records have no automatic eviction; the host owns retention and disk quotas.

## Offline smoke test

From the repository root:

```sh
pnpm --filter @anvia/acp build
node packages/acp/dist/cli.js packages/acp/examples/sample-agent.mjs
```

Send this newline-terminated request on stdin:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { "protocolVersion": 1, "clientCapabilities": {} }
}
```

Expect a response with `protocolVersion: 1`, `authMethods: []`, and load/resume/list/close/delete
capabilities. Optional media and HTTP MCP remain disabled. The sample constructs a real Anvia agent with an offline fixture model; no API
key is needed. EOF, SIGINT, and SIGTERM stop the transport.

`pnpm --filter @anvia/acp test` builds the package and runs unit and real subprocess tests.
The subprocess tests exercise the built bin, sample agent, factory loading, stdout isolation,
startup errors, EOF, and signals. Session tests cover isolation, concurrent prompts, multi-turn
history, content conversion, resource limits and teardown. Update tests cover ordering, reused tool
IDs, failures, reasoning policy, presentation, refusals and one final settlement. Cancellation tests
cover provider/tool signals, pending callbacks, late updates, session isolation and cleanup. Permission tests cover allow/reject, malformed responses, late approvals, elicitation,
and budgets across suspensions in both model modes. MCP fixtures cover modern/legacy HTTP,
real stdio fallback, environment isolation, approvals, collisions, rollback, cancellation and
exact endpoint trust. These are not editor compatibility claims.

Manual editor verification belongs to ACP 10 after the remaining bridges exist:

- Configure Zed and one JetBrains/Neovim client with the built launcher and an absolute module path.
- Record editor versions; verify the handshake and stderr/stdout separation.
- Exercise two chat turns, approval/denial, cancellation, MCP, and subprocess exit.
- Confirm supplied stdio args/env and session cwd in a trusted fixture; verify a denied call never executes.
- With a library host enabling HTTP, verify a pinned editor endpoint connects and another private URL fails.
- Opt into editor tools; verify unsaved-buffer reads, proposed write diffs/locations, and denied writes.
- Cancel a long terminal command and verify kill/release; also cancel while terminal creation is delayed.
- Switch model/mode during a pending approval; verify cancellation and that a late approval cannot execute.
- Verify slash-command completion/expansion, image prompts, and embedded text context.
- For a Docker backend, seed a known workspace explicitly and verify mapped paths in the editor.
  Docker daemon and real editor GUI verification were not run for ACP 08; headless fixtures cover
  the protocol and mapping contracts.

See [DESIGN.md](./DESIGN.md) for the proposed contract and later task boundaries. External
documentation should describe this as partial ACP support until editor verification is available. The new `reasoning`, `toolPresentation` and `AcpToolPresentation`
options, plus `turnBudget` / `AcpTurnBudget` and `mcp` / `AcpMcpOptions` / `AcpMcpServer`, plus `editorTools`, `models`, `readOnlyMode`, `commands`, `embeddedContext`, `readOnlyTools`,
`AcpSessionConfig`, `AcpCommand`, `diffs`, presentation `text`, and `mapSandboxPath` need coverage in ACP 16 external docs.
