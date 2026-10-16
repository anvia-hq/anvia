# @anvia/acp

Agent-side [Agent Client Protocol](https://agentclientprotocol.com/libraries/typescript)
adapter for Anvia. Applications supply their own agents, models, tools, and credentials.

**Current status: ACP 05 cancellation.** The package supports stable v1 initialization,
no-op authentication, NDJSON transport, a dedicated launcher, and in-memory sessions with
multi-turn prompt execution. Text/resource references work by default; images are opt-in.
`session/update` streams assistant text and tool status with stable session-local IDs;
`session/prompt` settles once with a stop reason after updates finish. `session/cancel` aborts the active turn and settles it with `cancelled`. Permission
bridging and editor MCP connections are subsequent tasks. Nonempty MCP declarations are rejected explicitly.

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

Factories are loaded and validated as functions at startup and called once per `session/new`,
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
clears history and disposes bindings without closing the caller's output stream. `closed` resolves
after cleanup on EOF, explicit close, or transport failure. Library shutdown waits for cooperative
factories/runs/disposers; the launcher bounds its shutdown wait to five seconds.

Optional settings are `agentInfo: { name, version, title? }` and `maxMessageBytes` (10 MiB by
default). Oversized input closes the connection through the SDK's bounded NDJSON reader.
`initialize` always returns protocol version `1`, including when another version is requested,
as specified by [ACP version negotiation](https://agentclientprotocol.com/protocol/v1/initialization).
Optional persistence and MCP transport capabilities are disabled. Local/editor
filesystem and terminal tools are not installed. Unknown methods return `-32601`, invalid
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
application code. Editor filesystem and terminal tools stay disabled even if the client advertises them.

Text becomes Anvia user text parts. Resource links become labelled references containing name,
URI and description; no URI is fetched. Set `images: true` on `serveStdio` or `createAcpConnection`
to accept base64 PNG, JPEG, GIF and WebP images. Every factory result must then have an
image-capable model. The launcher uses defaults; opt-in requires a library host. Images map to
Anvia image parts with their MIME type. Audio, embedded resources, disabled images and unsupported
MIME types fail with `unsupported_content` (`-32602`); malformed base64 fails with `invalid_content`.
Annotations and `_meta` never become model instructions or permission overrides.

Streaming models use one stream consumer; completion-only models use `generate`. Unsupported
approval/question suspensions fail with `unsupported_interaction` without resuming the tool.
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
lines are one-based. Titles are limited to 200 characters with controls removed; at most 100
locations are shown. Invalid lines and paths containing controls are omitted. Locations only
annotate the UI and grant no filesystem permission. Include only public metadata in the callback;
its errors are sanitized. Diffs and rich result content belong to ACP 08.

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

Editor-supplied MCP and permission bridges are not implemented yet. Cancellation tests use real
Anvia runs with fixture local/MCP tools and the internal pending-request registry, plus v1 byte
streams; they do not claim real editor compatibility.

## Resource bounds

Configure `limits` on the library host. Every value must be a positive safe integer.

| Option               | Default | Scope                                                       |
| -------------------- | ------- | ----------------------------------------------------------- |
| `maxSessions`        | 32      | Connection, including in-progress factories                 |
| `maxPromptBytes`     | 10 MiB  | Aggregate text and encoded-image bytes per prompt           |
| `maxTextBytes`       | 1 MiB   | UTF-8 text, including rendered resource references          |
| `maxImageBytes`      | 5 MiB   | Decoded bytes per image                                     |
| `maxContentBlocks`   | 256     | Blocks per prompt                                           |
| `maxHistoryBytes`    | 16 MiB  | Serialized private history per session                      |
| `maxHistoryMessages` | 1,000   | Private history messages per session                        |
| `maxPendingRequests` | 16      | Outstanding editor requests per session (for later bridges) |

Limit violations return `resource_limit` (`-32602`). The separate `maxMessageBytes` wire limit
includes metadata and closes the connection on overflow. History uses an adapter-owned in-memory
`MemoryStore`, with atomic completed-turn appends. It does not silently truncate or evict messages.
A response that exceeds the history budget fails the prompt, preserving prior history; application
effects that already ran cannot be undone. A prompt that already exceeds the history budget is
rejected before execution. Failed, blocked, suspended and exhausted runs preserve prior history only.
Provider/tool transient allocations are not bounded by the stored-history budget.

Sessions last until connection close; persistence, per-session close/delete RPCs and eviction are
not implemented. Reconnect to release a full connection, or create a new session if capacity remains.

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

Expect a response with `protocolVersion: 1`, `authMethods: []`, and disabled optional
capabilities. The sample constructs a real Anvia agent with an offline fixture model; no API
key is needed. EOF, SIGINT, and SIGTERM stop the transport.

`pnpm --filter @anvia/acp test` builds the package and runs unit and real subprocess tests.
The subprocess tests exercise the built bin, sample agent, factory loading, stdout isolation,
startup errors, EOF, and signals. Session tests cover isolation, concurrent prompts, multi-turn
history, content conversion, resource limits and teardown. Update tests cover ordering, reused tool
IDs, failures, reasoning policy, presentation, refusals and one final settlement. Cancellation tests
cover provider/tool signals, pending callbacks, late updates, session isolation and cleanup. These are not
editor compatibility claims.

Manual editor verification belongs to ACP 10 after the remaining bridges exist:

- Configure Zed and one JetBrains/Neovim client with the built launcher and an absolute module path.
- Record editor versions; verify the handshake and stderr/stdout separation.
- Once implemented, exercise two chat turns, approval/denial, cancellation, MCP, and subprocess exit.

See [DESIGN.md](./DESIGN.md) for the proposed contract and later task boundaries. External
documentation should describe this as partial ACP support until permissions and MCP integration are available. The new `reasoning`, `toolPresentation` and `AcpToolPresentation`
options need coverage in the ACP 16 external documentation task.
