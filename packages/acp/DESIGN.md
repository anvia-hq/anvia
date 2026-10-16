# ACP 01: `@anvia/acp` contract

Status: proposed, pending Indra review. Baseline verified on 2026-10-16.

This is the repository design contract for the agent-side adapter. ACP 01 added documentation
only. ACP 02 now implements the package manifest, pinned SDK, stream/stdio entrypoints,
initialization, no-op authentication, and launcher. The remaining APIs and capabilities below
are implementation targets, not claims of editor compatibility. Later tasks own session
execution and optional capabilities.

### ACP 02 implementation status

`createAcpConnection` and `serveStdio` expose `closed` and idempotent `close()`. The launcher
`anvia-acp <module-path>` loads trusted JavaScript modules exporting a named/default session
factory or Anvia agent. It reserves protocol stdout before import and redirects console/direct
`process.stdout.write` logging to stderr. The library leaves process logging/signals to its host.
Only `initialize` and `authenticate` are registered; session methods return `-32601`. No factory
is invoked during initialization. The public factory types establish the ACP 03 boundary.
The SDK validates envelopes and method parameters, handles JSON-RPC errors, and bounds incoming
messages to 10 MiB by default. Tests cover the built launcher with an offline sample agent;
real editor chat remains unverified until session execution is implemented.
The v1 output boundary removes SDK error details that can echo invalid request bodies; only
standard error codes/messages and the adapter's initialization error kinds reach the client.

Additional proposed decisions — pending Indra review:

- Launch local ESM JavaScript via one module-path argument; TypeScript needs an explicit host loader.
- Prefer factories; normalize an exported singleton Agent to a single-use factory and reject reuse.
- Import failures report generic stderr diagnostics, never raw provider errors or stacks.
- Add the runtime `@anvia/mcp` dependency when ACP 07 actually connects MCP servers; ACP 02 uses
  only core MCP types in the factory contract.
- Scaffold shutdown has no sessions/resources to drain. The launcher exits on signals; the
  output drain is bounded to five seconds, and imported module handles cannot hold the process
  open after EOF or startup failure. The session manager will add resource cleanup when it owns
  live session resources.

## Protocol and dependency baseline

| Boundary              | Exact baseline                                                                     |
| --------------------- | ---------------------------------------------------------------------------------- |
| Wire protocol         | Stable ACP v1; `initialize.protocolVersion` is the integer `1`                     |
| TypeScript SDK        | `@agentclientprotocol/sdk` **`1.9.0`**, without `^` or `~`                         |
| Stable schema         | ACP **`1.26.0`**, as bundled/generated in SDK `1.9.0`                              |
| Transport             | Bidirectional JSON-RPC 2.0 over newline-delimited UTF-8 stdio                      |
| Experimental protocol | Disabled; SDK's bundled v2 schema `2.0.0-alpha.9` is not a supported wire contract |

The [SDK v1.9.0 release](https://github.com/agentclientprotocol/typescript-sdk/releases/tag/v1.9.0)
records both schema versions. The schema version is not the integer protocol version, and
does not require inventing a separate schema dependency. ACP 02 must use the exact SDK
dependency and commit its pnpm lockfile resolution. Any subsequent SDK/schema upgrade must
update this table deliberately and rerun protocol fixtures; do not follow `latest` at runtime.

Use the SDK's fluent `agent()` API, not the deprecated `AgentSideConnection`, as recommended
by the [TypeScript guide](https://agentclientprotocol.com/libraries/typescript). Keep SDK types
and errors at the wire boundary. `initialize` returns `1` even if the client requests another
version; the client must decide whether it supports that response before proceeding, per
[version negotiation](https://agentclientprotocol.com/protocol/v1/initialization).

Future v2 support belongs in a separate `wire/v2` adapter and explicit experimental entrypoint.
It must share the session coordinator and normalized events, not v1 request/response state.
In particular, the coordinator owns a turn's completion independently of the v1 pending
`session/prompt` RPC. This leaves room for v2 acknowledgement plus state updates, keyed upserts,
and MCP-backed tools without client `fs/*` or `terminal/*`.
See the [v2 migration guide](https://agentclientprotocol.com/protocol/v2/migration).

## Proposed decisions — pending Indra review

All Anvia-specific defaults and policies in this document are proposals under this heading,
including the detailed contracts in subsequent sections. Protocol requirements are sourced
separately. These decisions are explicit defaults for implementation, not completed approval.

| Question                     | Proposed decision and consequence                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product shape                | Framework adapter. Applications supply an Anvia agent factory; no bundled coding agent, provider SDK, or default model.                                                                                                                                                                                                                                                   |
| Model and credentials        | The application configures both through its own Anvia agent/provider setup. Advertise `authMethods: []`; a schema-valid `authenticate` is an idempotent no-op returning `{}`. Never collect credentials through ACP, infer a login flow, or expose provider secrets. Missing provider credentials produce a sanitized configuration error, not an editor login challenge. |
| Session persistence          | An adapter-owned in-memory session store by default. Records and multi-turn context last only for the connection lifetime. Do not select SQLite or an application `MemoryStore` implicitly.                                                                                                                                                                               |
| Local/editor fs and terminal | Off by default. Local tools require explicit application registration; editor-backed tools require explicit opt-in plus the corresponding client capability. Advertising a capability alone grants no permission.                                                                                                                                                         |
| Modes/config options         | Permission presets on the same agent first: `ask` by default and optional `read-only`. No model or agent switching in the first release. Prefer config options; legacy modes, when exposed, alias the same preset. `read-only` admits only application-classified reads, and still honors an existing approval requirement. Unknown effects are denied.                   |
| Disconnect                   | Cancel all active turns and pending interactions, invalidate continuations, and dispose connection-owned sessions/resources. Never continue in the background or accept a late approval. Already-started side effects may have happened; do not retry them automatically.                                                                                                 |
| Cross-process restore        | Not required for the first v1 MVP. No load/resume/list/close/delete advertisement until ACP 11 implements and tests each operation. Persistent history does not imply resumable execution.                                                                                                                                                                                |
| Permissions                  | Offer `allow_once` and `reject_once` only. No “always” grant cache, across either turns or sessions. Application tools retain `requiresApproval`; editor and client-supplied MCP tools require approval by default.                                                                                                                                                       |
| Concurrency                  | One active prompt per session; reject overlapping prompts rather than queueing. Different sessions may run concurrently with isolated cwd, histories, callbacks, and tool IDs.                                                                                                                                                                                            |
| Runtime                      | Direct `Agent.stream()` driver first. Durable execution, a client-side adapter, remote transport, and the `anvia acp` CLI command are later tasks.                                                                                                                                                                                                                        |
| Content/privacy              | Text and resource-link references in the MVP. Images and embedded context are later opt-ins; audio is unsupported initially. Suppress reasoning and signatures in editor updates and transcript replay.                                                                                                                                                                   |

An application can provide trusted custom tools that do arbitrary work. This adapter is not
a sandbox for application code. Permission presets govern registered operations; they cannot
retroactively classify or constrain unmediated provider-side tools. Do not offer `read-only`
for an agent with execution paths whose effects cannot be enforced.

## Session factory API

The factory is called once for each successful `session/new`, after validating the absolute
cwd, authorizing MCP configuration, and connecting session-owned MCP clients. It receives
Anvia tool/server contracts and a normalized capability snapshot, never the raw SDK connection.
It returns a fresh agent for the session and an optional cleanup callback. Provider clients
may be shared by the application; mutable agent/session state may not.

Proposed TypeScript surface (a design sketch, not a compiled public entrypoint):

```ts
import type { Agent } from "@anvia/core/agent";
import type { McpServer } from "@anvia/core/mcp";
import type { AnyTool } from "@anvia/core/tool";

type AcpClientCapabilities = Readonly<{
  readTextFile: boolean;
  writeTextFile: boolean;
  terminal: boolean;
  elicitationForm: boolean;
}>;

type AcpSessionPolicy = Readonly<{
  permissionPreset: "ask" | "read-only";
  workspaceRoots: readonly string[];
  editorTools: Readonly<{
    readTextFile: boolean;
    writeTextFile: boolean;
    terminal: boolean;
  }>;
}>;

type AcpSessionContext = Readonly<{
  sessionId: string;
  cwd: string;
  clientCapabilities: AcpClientCapabilities;
  policy: AcpSessionPolicy;
  mcpServers: readonly McpServer[];
  editorTools: readonly AnyTool[];
  signal: AbortSignal;
}>;

type AcpSessionBinding = Readonly<{
  agent: Agent;
  dispose?: () => void | Promise<void>;
}>;

type AcpSessionFactory = (
  context: AcpSessionContext,
) => AcpSessionBinding | Promise<AcpSessionBinding>;
```

The initial binding targets a text-output Anvia `Agent`; the application supplies model,
instructions, tools, and credentials. It passes `context.mcpServers` to `AgentOptions.mcpServers`
and includes `context.editorTools` in `tools`. The coordinator validates that required supplied
tools were attached without dropping their permission wrappers. No tools are silently injected
after construction. The signal covers session lifetime, including factory setup; each prompt
gets a separate linked abort signal. The policy is an immutable creation snapshot. Later
preset changes are read through session-owned permission checks, not captured stale values.

Proposed host entrypoints are `createAcpConnection({ sessionFactory, ...policyOptions })` for
caller-owned streams and `serveStdio({ sessionFactory, ...policyOptions })` for a launcher.
Both return an idempotent `close()` and a `closed` promise. Creating/importing the library must
not attach process listeners, write stdout, or start a provider. The stdio launcher owns process
signals. Protocol capability options are configured before `initialize`; the host must guarantee
that every session factory result supports any advertised prompt capability.

### Ownership and lifecycle

1. Require initialization. Validate cwd as an absolute existing directory within host-configured
   workspace roots (default: the validated cwd itself). Never call `process.chdir()`.
2. Allocate an opaque session ID and setup cancellation scope. Validate all requested MCP servers
   before spawning any; connect them with rollback on partial failure.
3. Call the factory, validate its binding, and only then publish the session record. Setup failure
   disposes acquired MCP clients and any returned binding. A factory that throws must clean up
   its own partially acquired resources; a binding returned after cancellation is disposed.
4. A session record owns cwd, effective config, agent, private history, safe transcript, active
   turn, pending interaction identities, and cleanup handles. Store live handles separately from
   any future serializable metadata. No raw SDK messages are the canonical session state.
5. On teardown, invalidate callbacks first, abort the stream, close MCP/terminal resources,
   invoke `dispose` once, and remove the record. Cleanup attempts all resources even if one fails.

Default history is adapter-managed: start a turn with `Agent.stream({ messages, ...settings })`,
using private prior outcome messages plus the new user message. Keep one authoritative history;
do not also configure agent memory in this mode. A memory-backed binding is a future explicit
mode using `{ prompt, session }`, with an isolated `MemoryScope`. The MVP must reject an agent
with memory rather than accidentally duplicate or share history. ACP session storage and Anvia
model memory are separate contracts. Completed outcomes replace history once, rather than
appending the full outcome repeatedly. Cancellation retains only consistent completed messages;
never carry an unanswered tool invocation into a fresh model request.

## Capability matrix

“MVP” is the target after ACP 02–07, not functionality shipped by this document. Implemented
handlers, host opt-in, and client capabilities must all agree before advertising/using a feature.
Absent optional capabilities mean unsupported; no optimistic probing or silent downgrade.

| ACP surface                                      | MVP target                                        | Later work / gate                                                                               |
| ------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `initialize`                                     | v1, agent identity, conservative capabilities     | SDK/schema upgrades are explicit                                                                |
| `authenticate`                                   | No-op; `authMethods: []`                          | Custom auth would need a separate contract                                                      |
| `session/new`                                    | Absolute cwd, fresh agent, stdio MCP              | Policy validation before effects                                                                |
| `session/prompt`                                 | Pending until the whole turn ends                 | No premature response at an approval suspension                                                 |
| `session/cancel`                                 | Abort active turn; settle prompt as `cancelled`   | Idle/unknown-session notification is harmless                                                   |
| `session/update`                                 | Text, tool start/progress/result                  | Rich diffs, locations, plan, usage in ACP 08; never fabricate provider data                     |
| `session/request_permission`                     | Once-only approval bridge                         | No always-allow/reject options                                                                  |
| Text / resource links                            | Supported; links remain references                | No implicit URI fetching                                                                        |
| `promptCapabilities.image`                       | `false`                                           | ACP 08: explicit host opt-in and compatible model                                               |
| `promptCapabilities.embeddedContext`             | `false`                                           | ACP 08: validated text resources                                                                |
| `promptCapabilities.audio`                       | `false`                                           | Future explicit conversion policy                                                               |
| Stdio MCP                                        | Supported, per-session ownership                  | Required ACP transport; no capability flag                                                      |
| `mcpCapabilities.http` / `.sse`                  | Both `false`                                      | HTTP after explicit trusted-local policy; legacy SSE deferred                                   |
| Client `fs.readTextFile` / `fs.writeTextFile`    | Unused; tools off                                 | ACP 08: opt-in, separate client flags and workspace policy                                      |
| Client `terminal`                                | Unused; tools off                                 | ACP 08: opt-in, lifecycle and cancellation cleanup                                              |
| `session/set_config_option` / `session/set_mode` | Unadvertised and unavailable                      | ACP 08: permission presets, validated while idle, atomic config/mode updates                    |
| `available_commands_update`                      | No commands advertised                            | ACP 08: explicit application command registry                                                   |
| `elicitation/create`                             | Unsupported interaction ends safely with an error | ACP 08: form-capable client, validated answers; no fabricated answers or terminal stdin prompts |
| `loadSession`                                    | `false`                                           | ACP 11: safe replay without model/tool execution                                                |
| `sessionCapabilities.resume/list/close/delete`   | Omitted                                           | ACP 11: advertise each only with working store semantics                                        |
| v2 / remote transports / durable driver          | Unavailable                                       | Separate adapters/tasks, never implicit fallback                                                |

An MVP `initialize` response therefore has `protocolVersion: 1`, `authMethods: []`,
`loadSession: false`, all three optional prompt flags false, both optional MCP flags false,
and empty `sessionCapabilities`, alongside `agentInfo`. Client fs/terminal flags are inputs,
not agent capability claims. These field names follow the
[initialization contract](https://agentclientprotocol.com/protocol/v1/initialization).

## Content and presentation policy

Preserve prompt block order. Validate the complete prompt before adding history, invoking a
model, or resolving resources. Unsupported blocks fail the whole prompt with invalid params;
never silently omit context. Text maps to Anvia user text parts. A resource link maps to a
clearly labelled user-context reference containing its URI, name, and supplied description;
it does not authorize a file read, HTTP request, or MCP resource read.

When enabled later, base64 images map to Anvia image parts after MIME and decoded-size checks.
Embedded text resources become labelled user-context text, never system instructions. Binary
embedded resources and audio remain rejected until a converter is explicitly implemented.
Untrusted annotations, resource text, and MCP instructions cannot widen host permissions.
These content distinctions follow the [ACP content contract](https://agentclientprotocol.com/protocol/v1/content).

Proposed bounded defaults: 10 MiB per incoming wire message, 1 MiB aggregate UTF-8 text per
prompt, and (when enabled) 5 MiB decoded per image, within the wire limit. Reject oversize
input explicitly. Bound output queues and tool output too; show a labelled truncation marker
for display-only truncation instead of losing the tool's success/failure status. Limits are
host configuration, not editor-controlled `_meta` values.

`events` consumes the agent stream once and fans out normalized events. Do not consume
`textStream` alongside `events`, or read `result` before starting event consumption (it can
auto-drain). Correlate tool calls using session/turn identity and Anvia internal call identity,
with an explicit mapping for provider IDs and continuation segments. Emit a tool once and
update the same editor ID for approval, execution, and completion. Never replay streamed text
again from the final outcome. Presentation supplies safe title/kind, absolute locations, and
optional diffs; unknown tool kinds use `other`.

Keep private model history distinct from the editor transcript. Do not forward generation
requests, system prompts, continuations, reasoning, signatures, raw provider responses, or
credential-bearing tool inputs. Public text and sanitized tool summaries form an allowlisted
projection for future replay. Redact error details and permission presentation as well.

## Permissions, turn completion, and cancellation

Use Anvia's `requiresApproval` and `AgentInteractionOutcome`/`AgentContinuation`; the adapter
must not execute a suspended tool directly. On approval suspension, emit its pending tool
state, request permission, validate the returned option ID against this request, then resume
with `{ continuation, response: { type: "tool-approval", approved } }`. Denial resumes with
`approved: false` so the model can explain or choose another operation. An absent, malformed,
cancelled, or failed permission reply never authorizes execution. A cancelled permission ends
the turn as cancelled; malformed replies fail the turn safely. No continuation crosses sessions.

Keep one ACP prompt pending across all continuation segments. Count model requests and usage
across segments, not once per `Agent.stream()` call; a continuation cannot reset the turn budget.
Use the configured agent limit (20 by default today) as a whole-prompt limit. Core continuation
budget semantics must be covered by ACP 06 tests before selecting the exact run-setting override;
do not inspect or mutate opaque `continuation.state` as a public API. Exhaustion maps to
`max_turn_requests`, even after multiple approval cycles.

Each active turn has an abort controller and generation token. Cancellation invalidates pending
permission/question callbacks synchronously; immediately before resumption and tool execution,
check both the token and abort signal. Drop late replies/updates. An idle cancel is a no-op.
An explicit `session/cancel` resolves the original prompt exactly once with `cancelled` after
cooperative work has stopped and pending updates have drained; it is not an ordinary RPC error.
See [prompt completion and cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn).

Disconnect (EOF, broken output, explicit connection close, or launcher shutdown) follows that
same invalidation path for every session. A broken transport cannot receive a prompt response;
settle local completion and release resources without trying to reconnect or resume. Allow a
5-second cleanup grace period by default, then the launcher terminates its owned resources.
For in-process tools that ignore abort, quarantine the affected session until execution settles;
never unlock it for another prompt or claim the side effect was rolled back. A library cannot
kill arbitrary caller code. Editor terminal cleanup is best effort once the connection is gone.

Permission presets cannot override an application's stricter `requiresApproval` or workspace
restriction. Configuration changes are allowed only while idle, cannot enable disabled
backends, and take effect atomically at the next prompt. Do not implement an always-allow mode.

## Execution backends and editor MCP

| Backend                 | Ownership and policy                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application local tools | Explicit factory registration. Resolve paths relative to session cwd and enforce roots inside the tool; no adapter-provided local fs/shell by default. |
| Editor fs/terminal      | Connection-bound wrappers exposed only after opt-in and capability checks. Require approval by default. Preserve unsaved-buffer semantics.             |
| Docker sandbox          | Application-owned tool backend, explicitly configured; no automatic Docker startup.                                                                    |
| Editor MCP              | Session-owned clients and wrapped tools; supports the future v2 tool direction.                                                                        |

Never switch to a different backend after a denied or unavailable editor operation. Validate
paths with canonical containment checks (including symlinks where the executing backend can
resolve them); lexical prefix checks are insufficient. Workspace roots do not sandbox an
arbitrary shell command: terminal opt-in and approval authorize that privileged operation.

ACP requires stdio MCP support in
[session setup](https://agentclientprotocol.com/protocol/v1/session-setup). Treat server launch
as privileged host configuration: validate command/args/env, unique names, cwd, and host policy
before spawning, use argv without a shell, keep child protocol stdout isolated, and route
diagnostics to stderr. By default the local editor that launches this process is the trusted
source of stdio server declarations; a host may restrict executable paths and environment keys.
This trusts server launch, not subsequent tool calls. Never inherit provider credentials into
MCP children implicitly; use an explicit environment allowlist plus approved supplied values.

Use `McpClientGroup` for all-or-nothing connection and teardown. Prefix tools by server and
reject collisions. Set `versionNegotiation: { mode: "auto" }` explicitly for editor servers:
the existing MCP default pins `2026-07-28`, but this repository already supports fallback.
Do not change `@anvia/mcp` defaults globally. Wrap MCP tools with approval policy because their
current conversion does not set `requiresApproval`; do not trust remote read-only annotations
as authorization. A setup failure rolls back every successfully connected client.

HTTP MCP remains unadvertised until ACP 07/08 provides explicit endpoint trust. Proposed policy:
strict URL safety by default; exact host-configured origins may opt into loopback/private access,
with redirects and DNS changes revalidated. Do not blanket-disable SSRF protection merely because
a URL came from an editor. Legacy SSE is deferred. Neither server configs nor environment/header
values belong in transcript replay or error data.

## Error model

The wire adapter translates normalized errors into SDK responses. Use standard codes from the
[ACP schema](https://agentclientprotocol.com/protocol/v1/schema); keep Anvia-specific reasons
in a small `data.kind` field, not invented global numeric codes.

| Condition                                                                   | Wire behavior                                                                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Malformed JSON / invalid envelope                                           | SDK parse error `-32700` / invalid request `-32600`                                                             |
| Method unavailable or not implemented                                       | Method not found `-32601`                                                                                       |
| Invalid cwd, content, config value, or MCP declaration                      | Invalid params `-32602`; safe kind such as `invalid_cwd` or `unsupported_content`                               |
| Request before initialization, duplicate initialization, overlapping prompt | Invalid request `-32600`; kind `not_initialized`, `already_initialized`, or `session_busy`                      |
| Unknown/closed session on a request                                         | Resource not found `-32002`; kind `session_not_found`                                                           |
| Host policy rejects setup                                                   | Invalid params `-32602`; kind `policy_denied`; no side effects                                                  |
| Factory, MCP connection, or provider failure                                | Internal error `-32603`; kind `configuration_error`, `mcp_connection_failed`, or `execution_failed`             |
| Tool execution failure                                                      | Failed tool update/result; let the agent handle it when possible                                                |
| Unsupported interaction / invalid permission response                       | Internal error `-32603`; kind `unsupported_interaction` / `invalid_permission_response`; never execute the tool |
| Cancelled prompt                                                            | Successful prompt result with `stopReason: "cancelled"`                                                         |
| Other request aborted during shutdown                                       | Request cancelled `-32800` if transport is still writable                                                       |
| Normal response / token limit / turn budget / guardrail refusal             | `end_turn` / `max_tokens` / `max_turn_requests` / `refusal`                                                     |

Do not use authentication-required `-32000` for missing application provider credentials when
no ACP authentication method is available. Notifications receive no RPC response. Errors have
a short safe message and optional kind/session ID; omit stacks, raw causes, prompts, tokens,
headers, and continuation state. Redacted diagnostics go to stderr. After a turn error, retain
only consistent history and clear locks in `finally`; quarantine if effects are still running.

## Module layout and package boundaries

Planned source modules (ACP 02 onward):

| Module                 | Responsibility                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `connection.ts`        | Connection lifecycle, capability snapshot, SDK v1 handler registration through `wire/v1`        |
| `wire/v1.ts`           | SDK request validation, normalized request/update translation, pending v1 prompt response       |
| `session-manager.ts`   | Session allocation, ownership, lookup, setup rollback, connection teardown                      |
| `session.ts`           | Single-session state, history, active prompt lock, direct Anvia execution and continuation loop |
| `content.ts`           | Prompt validation/conversion, size limits, resource policy                                      |
| `events.ts`            | Single stream consumer, normalized deltas, tool correlation, completion/usage accounting        |
| `permissions.ts`       | Once-only approval bridge, pending callbacks, preset checks and cancellation races              |
| `mcp.ts`               | Editor config validation, per-session clients, approval wrappers and teardown                   |
| `presentation.ts`      | Safe tool titles/kinds, locations/diffs and transcript projection                               |
| `errors.ts`            | Stable internal error kinds and safe wire error mapping                                         |
| `stdio.ts`             | Node stream wiring, stderr diagnostics, launcher lifecycle and stdout discipline                |
| `types.ts`, `index.ts` | Explicit adapter-owned contracts and public re-exports                                          |
| `wire/v2.ts` (future)  | Separate experimental wire semantics; no first-release export                                   |

Follow `packages/mcp`, `packages/client`, and `packages/durable`: ESM source in `src/`, Vitest
in `test/`, shared strict TypeScript config, tsup declarations, and explicit `dist` exports.
The library root must be side-effect free; stdio gets its own entrypoint/bin. Core is a
`workspace:^` peer and `workspace:*` development dependency; runtime MCP integration is a
`workspace:*` dependency, with the exact external SDK pin above. Provider SDKs stay in provider
packages. Do not make `@anvia/core`, `@anvia/client`, or `@anvia/server` depend on ACP.

Relevant existing contracts:

- [Agent inputs/events/outcomes](../core/src/agent/run-types.ts) and
  [stream consumption](../core/src/agent/agent-stream.ts).
- [Interactions/continuations](../core/src/agent/interactions.ts) and
  [cancellation/errors](../core/src/agent/errors.ts).
- [MCP options and protocol negotiation](../mcp/src/types.ts),
  [client group ownership](../mcp/src/client-group.ts),
  [tool conversion](../mcp/src/tool.ts), and [URL safety](../mcp/src/url-safety.ts).
- [Durable registration restrictions](../durable/src/registration.ts): memory, middleware,
  guardrails, and MCP currently need additional checkpoint support. No durable claim in the MVP.

## Implementation verification handoff

Future implementation tasks must cover: conservative initialization; multi-turn history;
isolation across cwd/session IDs; setup rollback; malformed/oversize content; stable tool IDs;
denial without execution; cancel-before/after approval with late replies; one budget across
continuations; disconnect during setup/approval/tool execution; and stdout containing only
JSON-RPC. Use fake models/tools, a real stdio subprocess fixture, and pinned-schema validation.
No real provider keys should be required for ordinary tests.

ACP 09 owns fixture/conformance automation. ACP 10 owns manual editor verification in Zed and
an independent JetBrains or Neovim client: chat across two turns, tool approval/denial, cancel,
client MCP, subprocess exit, and stderr/stdout separation. Record editor versions and results;
this design does not claim those checks have run. ACP 11 adds replay tests proving no system
prompt/reasoning leakage and no tool re-execution. Publication remains operator-controlled.
