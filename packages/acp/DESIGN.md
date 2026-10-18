# ACP 01: `@anvia/acp` contract

Status: proposed, pending Indra review. Baseline verified on 2026-10-16.

This is the repository design contract for the agent-side adapter. ACP 01 added documentation
only. ACP 02 implements the package manifest, pinned SDK, stream/stdio entrypoints,
initialization, no-op authentication, and launcher. ACP 03 adds session creation and prompt
execution with bounded in-memory history. ACP 04 adds ordered text/tool updates and optional
plaintext reasoning. ACP 05 adds per-turn cancellation. ACP 06 adds approval/question continuations and whole-prompt budgets. ACP 07 connects editor MCP servers per session. The remaining APIs and capabilities below
are implementation targets, not claims of editor compatibility. Later tasks own session
execution and optional capabilities.

### ACP 14 implementation status

Production hardening is implemented. [SECURITY.md](./SECURITY.md) records assets, attackers,
trust boundaries, controls, residual host responsibilities and the error-path audit. These
defaults supersede earlier ACP 07 launch trust and the shared admission/editor root scope:

- Client stdio MCP is denied unless `mcp.stdio: true` **and** `authorizeServer` returns exactly
  `true` for each declaration. Host approval happens before any process or connection, including
  the SDK's discovery probe. Tool calls still require independent once-only approval. The
  launcher uses defaults and cannot accept client stdio declarations; constrained library hosts
  can opt in. Environment names must be identifiers; approved env values can still execute code
  (for example `NODE_OPTIONS`), so the host must approve the full executable/argv/env/cwd tuple.
- HTTP remains disabled by default. Reuse `@anvia/mcp` strict URL/DNS/fetch safety through
  `McpClient`; exact host endpoints with pinned addresses remain the only private-access exception.
  No copied URL-safety logic, SSRF bypass option or change to `@anvia/mcp` is introduced.
- `workspaceRoots` admits sessions only. Editor read/write paths and terminal cwd default to
  canonical session cwd even when admission covers a parent directory. Explicit host
  `editorWorkspaceRoots` adds directories. Existing-ancestor realpath checks reject symlink and
  dangling-symlink escapes, `..`, absolute outside paths and prefix siblings. The editor must
  enforce access-time policy; separate-process checks cannot close filesystem mutation races.
- Add positive-integer `limits.maxConcurrentRequests` (64), `maxTerminalOutputBytes` (1 MiB),
  `maxReplayBatchEntries` (10,000), and `maxReplayBatchBytes` (16 MiB). Keep 10 MiB incoming wire
  messages, 32 active sessions including setup and 16 pending editor requests per session.
  Concurrent RPC overflow or duplicate outstanding IDs closes before SDK allocation; replies and
  cancellation notifications still flow. Terminal creation requests the configured retention bound
  and rejects oversized UTF-8 output. A v1 load is one replay batch: validate both bounds before
  teardown/factory/MCP setup or updates; no partial replay/truncation. Silent resume remains usable.
- Await updates/replay individually. Merge adjacent **retained** text chunks up to 64 KiB to reduce
  allocation and replay entries; live chunks, ordering, tool IDs and content remain unchanged.
  Check byte budgets incrementally without serializing the growing text per delta. This also
  normalizes older fine-grained stored transcripts on restore.
- SDK 1.9.0 sends `$/cancel_request` without settling its pending response entry. The wire stream
  also delivers a fixed local cancellation response to the SDK so cancelled permission/editor
  RPCs release promises/maps even if the client never replies. Late replies are ignored; terminal
  creation remains deliberately uncancelled to retain late IDs for cleanup. `wire-resources.test.ts`
  repeats 128 cancellations with no peer replies and inspects SDK maps/listeners, then closes with
  another pending request. No production access to SDK internals is used.
- Preserve fixed error kinds and final SDK error sanitization. Inject private errors through
  factories, MCP policy, storage read/write, disposal, config rebuilds, commands, presentation and
  provider execution. Existing tests cover malformed envelopes/schema, client interaction errors,
  tool status, startup and durable recovery. Public model text and trusted presentation are
  deliberate output, not error diagnostics; the host must keep secrets out of these projections.

Verification lives in `test/hardening.test.ts`, `test/mcp.test.ts`,
`test/streaming-resources.test.ts`, `test/wire-resources.test.ts` and the existing connection/content/session/pending-request,
editor, permissions, updates, persistence, launcher and durable tests. No tests need provider keys.
The long-session test runs 64 turns × 256 chunks for each cancel/close case, then interrupts a
stream with a pending callback. It asserts zero open streams, pending requests, abort listeners,
fake deadline timers and manager session/setup/operation map entries after cleanup; disposal runs
once, memory clears and no updates arrive late. Persistent records intentionally outlive close.

#### Profiling

Opt in from repo root after workspace dependencies are built:

```sh
node --expose-gc --import tsx packages/acp/bench/stream.mjs
# Optional positive arguments: turns chunksPerTurn chunkBytes
```

Offline fake streaming model, macOS arm64 / Apple M4, Node v26.9.0,
100 turns × 512 deltas × 128 ASCII bytes: 51,200 live
updates, 6.25 MiB output, default history limits and an active 60-second deadline per turn.
This measures session execution/projection/history/store overhead; it excludes editor I/O and
wire serialization. Sampled peaks are heap snapshots after turns, not an allocation ceiling.

| Measurement                                           | Before retained-text merging | After      |
| ----------------------------------------------------- | ---------------------------- | ---------- |
| Wall time                                             | 3,223 ms                     | 1,056 ms   |
| Live updates/second                                   | 15,886                       | 48,507     |
| GC heap before workload                               | 24.13 MiB                    | 24.03 MiB  |
| Peak sampled heap                                     | 364.40 MiB                   | 356.72 MiB |
| GC heap after workload (history retained)             | 56.30 MiB                    | 54.86 MiB  |
| GC heap after close + explicit record deletion        | 23.40 MiB                    | 23.29 MiB  |
| Remaining lifetime abort listeners / pending requests | 0 / 0                        | 0 / 0      |

Both runs use the same script/input and include bounded successful history. The post-close GC
heap returns below its pre-workload value; deterministic resource assertions provide the cleanup
regression test rather than a flaky heap threshold. History cloning/validation and provider/core
transient allocations still make peak heap much larger than retained text; tune host capacity and
limits for concurrent deployments. Closing alone retains stored records by design, so the script
explicitly deletes its own record before the final measurement. Numbers are local observations,
not CI performance thresholds.

#### v2 readiness and remaining gaps

Checked against the pinned SDK 1.9.0 `AgentProtocolRouter`/`agentProtocolRouter` declarations and
the [official v2 migration guide](https://agentclientprotocol.com/protocol/v2/migration)
on 2026-10-18. v2 remains disabled; live documentation can advance beyond the bundled alpha.9
schema. Implement to a deliberately pinned schema when enabling the feature.

| v2 surface                                            | Internal model today                                                                                                                                                           | Work before enabling                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt acceptance versus lifecycle                    | `AcpSession` owns active turn, cancellation, pending interaction and completion independently of RPC; `prompt()` returns final stop reason.                                    | Add accepted prompt identity/ack and project running/requires-action/idle/failure state. Never leave execution ownership in an RPC responder or treat acknowledgement as completion.                       |
| Keyed upserts                                         | Normalized tool IDs remain stable through continuation and replay; `events.ts` owns projection without SDK types. Text is append-only; presentation patches use absent fields. | Add stable message/content/plan IDs, complete upsert state and omit/null/value semantics, plus terminal display state if supported. Do not reinterpret v1 deltas as complete v2 state.                     |
| Session/resume replay                                 | Store already separates canonical history and allowlisted display transcript. v1 load replays; resume is silent and both fence cwd/config/driver identity.                     | Replace load with resume replayFrom, stable replay cursors/IDs, snapshot-plus-live handoff and dedup semantics. Current replay batch bounds remain admission policy; no claim of resumable cursor support. |
| No client fs or terminal execution APIs               | `EditorClient` is a protocol-independent optional backend; disabled by host/capability intersection. MCP bindings are session-owned.                                           | v2 capability snapshot leaves editor backend off. Use approved client MCP tools. Agent-owned terminal display is separate from client execution. Durable connection-owned tools remain unsupported.        |
| Initialization, required session baseline and routing | `wire/v1.ts` contains SDK normalization/registration only; `createV1Agent()` returns a connector usable by `router.withV1()`. Session/events/storage have no SDK dependency.   | Add separate `wire/v2.ts` and explicit feature flag, route through the SDK router once per connection; map v2 info/capabilities and require session/list support. Preserve v1 fallback.                    |

No speculative v2 event schema or core-runtime refactor is introduced. Product questions are
recorded in SECURITY.md: launcher host-policy configuration, whether public HTTP should require
an endpoint allowlist too, and hosted retention/quota policy. Safe defaults remain in force.

### ACP 13 implementation status

`@anvia/cli` adds `anvia acp --agent ./agent.ts`. Both it and the dedicated `anvia-acp` bin call
`runStdioServer(modulePath)` from the new `@anvia/acp/launcher` entrypoint, which reuses the existing
module loader and `serveStdio`. Importing the entrypoint has no process side effects; calling it
owns stdout, signals, and process exit. Embedded hosts continue to use `serveStdio`.

Implementation defaults:

- ACP is an optional CLI peer, dynamically imported only for `acp`, plus a workspace development
  dependency. The peer requires the 0.2 minor line containing the launcher API. Missing ACP prints
  an install command on stderr; skills/UI commands and help do not require the runtime. The CLI's
  TypeScript source path mapping supports workspace checks before packages are linked/built;
  tsup keeps the runtime import external. The packed peer range is verified by release tooling.
- Load trusted local ESM `.js`/`.mjs` modules on every supported Node version (>=20.18.1). TypeScript
  relies on native type stripping, enabled by default in Node 22.18+ and 23.6+. No bundled transpiler
  or automatic respawn/loader installation. On Node 20 or with stripping disabled, report safe
  guidance to compile JS or enable native stripping/use a caller-supplied loader. Erasable syntax
  and explicit import extensions are required; no `tsconfig` aliases or JSX transformation.
- Preserve named `sessionFactory`, default factory, named/default Agent precedence and single-use
  exported agents. Factories run on session creation/restore, not initialization. Distinguish bad
  paths, invalid/missing exports, and unsupported TS from generic import/provider failures using
  fixed diagnostics only; never expose raw causes or stacks.
- Reserve stdout and redirect console/direct stdout writes before loading user modules. Install
  signal handlers before asynchronous initialization. EOF, SIGINT, SIGTERM and output failure
  trigger idempotent connection close and await session/MCP/disposer cleanup before draining output
  and exiting, with a five-second deadline for uncooperative code. Module-owned terminal handles
  belong in binding disposal; existing editor-terminal cancellation/release semantics remain.
- Both READMEs include a local install and Zed `agent_servers` configuration using one launch command
  and absolute executable/module paths. Headless subprocess tests verify protocol behavior, not editor GUI UX.

`packages/cli/test/acp.test.ts` exercises built installations with/without the optional peer,
JS/TS modules, multi-turn prompts, stdout isolation, sanitized failures, EOF, signals during module
initialization and resource disposal. `packages/acp/test/launcher.test.ts` continues to cover the
dedicated bin; `test/editor-features.test.ts` covers terminal kill/release on cancellation.
No additional product decision is required for these defaults. External docs in ACP 16 should
cover the command, optional peer, Node/TS requirements and process-owned launcher API.

### ACP 12 implementation status

`@anvia/acp/durable` exports `createDurableSessionBinding(runtime, registration)`. It registers a
static agent once on a host-owned `DurableRuntime` and returns a reusable session-factory binding.
The default factory binding still uses ephemeral execution. The base adapter imports no durable
runtime code; durable is an optional peer plus a development dependency, with a separate export.
No changes to `packages/durable` or core execution internals are required.

Registration limits lifted: **none**. The following limits remain enforced by runtime registration:

| Kept limit          | Reason                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent memory        | Durable history owns ordering and recovery; a second memory writer has no atomic checkpoint boundary. ACP's store is a separate presentation/submission record, not agent memory. |
| Lifecycle callbacks | Effects in callbacks could repeat during reconstruction.                                                                                                                          |
| Middleware          | Request rewrites and effects are not independently checkpointed.                                                                                                                  |
| Guardrails          | Their callbacks and external checks lack replay boundaries.                                                                                                                       |
| Context sources     | Re-running a source can change saved model input or repeat effects.                                                                                                               |
| MCP servers         | Connection-owned catalogs and calls cannot be reconstructed as static, journaled tools.                                                                                           |
| Provider tools      | Remote provider effects have no independently reconciled tool intent.                                                                                                             |
| Tool indexes        | Dynamic discovery and tool identity need their own persisted boundaries.                                                                                                          |

Implementation defaults — editor attachment UX remains pending product review:

- Support static local tools/instructions, host-owned models, persisted approval/question responses,
  and optional durable model streaming. Reject ACP connection-owned editor tools (including reads),
  editor MCP bindings, binding disposers and `turnBudget`. Reject config changes on durable sessions.
  Runtime registrations and tool resources must outlive connections; do not close over connection
  signals or disguise unsupported integrations in local callbacks. Keep schemas, definitions and
  approval predicates pure; repeatable observability callbacks must not own business effects.
  Agent `maxTurns` is persisted and enforced by durable; ephemeral time/cost middleware is not
  silently applied or ignored.
- Keep built-in `fs/write_text_file` and `terminal/create` unavailable in durable bindings. They have
  no editor idempotency contract and their callbacks/resources belong to a connection. The adapter
  cannot silently repeat them. Host-owned static effect tools default to `ToolRecovery: "manual"`. Classify
  pure/repeatable reads as `safe`, and use `idempotent` only when the actual service deduplicates
  `ToolCallContext.operationId`. A policy label alone does not make an operation idempotent.
- Before submission, atomically save a private `pendingRun` containing a fresh request ID, converted
  prompt and original display blocks in ACP 11's record. Deduplicate submission with that ID and
  the ACP session ID. A crash before submission can safely submit later; a crash after submission
  or before final ACP commit reopens the same run. Durable is authoritative for model history and
  effects. ACP commits full canonical history and allowlisted transcript together, then removes
  the pending record. An ACP save failure retains the pending record and cannot rerun effects.
- Fence restore with a persisted driver/agent/version key. No automatic ephemeral-to-durable
  migration (including through a config rebuild) or registration-version migration. Keep both stores
  and their exclusive ownership together; deleting, independently restoring or reusing the runtime
  journal while keeping ACP records is unsupported. Do not submit/steer unrelated work into
  ACP-owned runtime session IDs.
- `session/load` replays completed ACP history; `session/resume` is silent. Both rebuild the binding
  without approving/submitting work. A host's startup `runtime.resume()` may independently resume
  saved executable work. To attach to a pending turn, send `session/prompt` with `prompt: []`.
  Nonempty input returns `session_busy` until the pending turn is settled or explicitly cancelled.
  No pending turn means empty input is still invalid. This explicit attachment convention needs
  editor UX verification; do not discard a new user message or treat it as implicit approval.
- Read an atomic snapshot, then subscribe with `run.stream({ after: snapshot.cursor })`. Project
  committed interaction/final outcomes only, never partial model attempts or raw journal events.
  Deliver authorized decisions through `run.respond()`, never core continuation APIs. A late reply
  after detach cannot write a decision. Reattachment reconstructs the uncommitted turn's display
  with stable request-scoped tool IDs; its text may be displayed again. It does not offer exactly-once
  display across disconnects. Completed load replay keeps the ACP 11 guarantees.
- Transport EOF/close and durable `session/close` **detach**, leaving execution/waits/checkpoints
  intact. Ephemeral close still aborts execution. `session/cancel` explicitly cancels the durable
  run, including a restored idle pending turn; it cannot undo effects. Cancellation cannot discard
  a completed runtime result awaiting ACP commit. Host shutdown calls `runtime.close()`, which
  aborts attempts while retaining checkpoints; after restart the host registers compatible code
  and calls `resume()`. Disconnecting an ACP subscriber never closes the shared runtime.
- Return sanitized `recovery_required` for `needs_attention`; retain the pending turn. Only a host
  operator can inspect private snapshots and reconcile verified results with `resolveTool()` or
  explicitly retry compatible failed work. Approval is not reconciliation. No automatic retry or
  fabricated success. Failed turns also stay pending until host recovery or explicit cancellation,
  except persisted model-turn exhaustion: return `max_turn_requests`, clear the pending submission,
  preserve prior committed history and allow the next prompt. The failed journal remains available
  to the host.
- Reject deletion while a pending turn exists: restore, explicitly cancel/settle it, then delete.
  Recheck after cancellation so a concurrent turn or failed final save cannot lose its pending record.
  Deleting ACP history does not delete durable journals. The host owns retention, access control,
  encryption, capacity limits and coordinated backups for both stores. Runtime admission and
  history limits remain host responsibilities; ACP checks its own prompt/history/transcript bounds.
  If completed output exceeds those bounds, raise the ACP limits and reattach; cancellation does
  not truncate or discard a completed durable result.

Tests cover multi-turn canonical history, pending approval detach and stale grants, stable tool IDs,
multiple approval segments with reused provider IDs, persisted questions, write-ahead/final-save
failures, deletion races, cancellation, registration/config fences and committed-only streaming retries.
`test/durable.test.ts` covers completed/manual/idempotent recovery and stable operation IDs.
`test/durable-process.test.ts` and `test/fixtures/durable-process.mjs` use real subprocess SIGKILL
tests to reopen both file/SQLite stores at approval, completed-effect and ambiguous-effect boundaries.
An idempotent crash case verifies two attempts with the same operation ID produce one external effect.
The normal server stdout remains protocol-only; snapshot errors, arguments/results and continuations
are never forwarded. ACP 16 should document this API/subset and the explicit reattachment convention.

### ACP 11 implementation status

Session lifecycle RPCs now use an adapter-owned `AcpSessionStore` alongside the existing
`SessionMemory` implementation of core's `MemoryStore`. Core's API is unchanged. Records include
canonical workspace, config, title/timestamps, presentation ID counter, model messages and a separate
allowlisted replay transcript. The default is `InMemoryAcpSessionStore`; `FileAcpSessionStore` is an
explicit host option with atomic snapshot replacement. Load and resume rebuild bindings and MCP
connections without generating output or executing historical tools. Only load replays history.

Proposed decisions — pending Indra review:

- Preserve framework-adapter scope, host-owned models/credentials, no-op authentication, default
  in-memory storage and local/editor tools off by default. File storage is a library-host option;
  do not add launcher configuration or a database dependency in ACP 11.
- Save completed turns atomically as one versioned envelope with both histories and metadata.
  Starting the store write is the completion boundary; later cancel/close waits for its outcome.
  Failed writes retain prior state. Suspensions/cancellations are not persisted checkpoints; an
  interrupted effect may already have happened. Durable recovery remains ACP 12.
- Store original user blocks (not command expansions), public text and sanitized tool presentation.
  Never reconstruct replay from private model messages. Exclude all reasoning, including opted-in
  plaintext, and all raw arguments/results/provider artifacts. Keep stable tool IDs across restore.
  Replay each committed entry once before the load response; resume emits no history. Loading into
  a client with existing display history requires that client to replace its view.
- Preserve sanitized presentation `text`, including terminal command/argv/cwd, on tool updates.
  Proposed decision: new tool IDs include a fresh runtime namespace as well as the persisted
  counter. Cancelled/failed turns may leave visible cards without committing that counter; the
  namespace prevents collisions after silent resume. Historical IDs replay unchanged and remain
  opaque to clients. Reject malformed known transcript fields before replay begins.
- Close releases execution/MCP/editor resources but retains records. Delete closes first and hard
  deletes stored history; absent deletes succeed. Existing empty records load successfully; missing
  records fail regardless of what a model MemoryStore might return. Idle active sessions may be
  rebound; active turns/config updates and concurrent lifecycle mutations return `session_busy`.
- Restore requires identical canonical cwd, current workspace policy and still-available stored
  mode/model. It never reuses saved capabilities, credentials, MCP launch/env/header declarations,
  approvals or continuations. Current clients resupply servers; current factories own credentials.
- Advertise load/resume/close because the required store contract implements them. Advertise list
  and delete only when the supplied store provides those methods. List metadata only, filter before
  pagination, 50 rows/page, newest-update-first keyset order with session-ID tie breaking and
  filter-bound tuple cursors. Built-in stores omit records without committed messages/transcript
  or a durable pending run; empty records still load/resume by ID. Titles default to the first
  completed original user text (200 characters), otherwise "Untitled session".
- One active connection owns a store. The file adapter serializes calls within one instance, writes
  0600 snapshots via rename, and creates 0700 directories. It is for modest local histories, not
  distributed writers or power-loss durability. The host owns trusted storage location, user
  isolation, exclusive access, encryption, retention, quotas and backups. No idle eviction or
  automatic record migration. Malformed entries and unknown versions fail closed when loaded and
  are skipped by file-store listing; unrelated entries remain intact during writes/deletes. An
  unreadable file envelope still fails closed. Both private history and transcript
  separately obey the existing per-session byte budget; active-session limits exclude stored data.

Tests cover real process restarts, exact replay and silent resume, continuation without historical
tool execution, privacy, empty-vs-absent records, configuration/workspace changes, pagination,
capability gates, replay failure, cancellation/close races and atomic-write failure. Protocol shapes
follow the pinned SDK plus [session setup](https://agentclientprotocol.com/protocol/v1/session-setup),
[list](https://agentclientprotocol.com/protocol/v1/session-list) and
[delete](https://agentclientprotocol.com/protocol/v1/session-delete). The v1 schema and pinned SDK
use `sessionCapabilities.resume`, `.list`, `.close` and `.delete`; only load uses `loadSession`.
Unimplemented `additionalDirectories` and unstable `fork`/`systemPrompt` stay unadvertised.
Real editor persistence UX remains
on the manual checklist; headless fixtures do not establish GUI compatibility. ACP 16 should carry
the new store options/types, lifecycle semantics and single-owner limitation into external docs.

### ACP 10 verification status

Repository-only editor smoke assets now exercise a deterministic streaming session factory and
stdio MCP server through the dedicated bin. The sample exposes turn history, an approval-gated
in-memory counter, cancellation and simulated configuration/credential failures. A config generator
writes reviewable Zed, JetBrains and CodeCompanion snippets without changing installed editors.
See [the compatibility matrix and manual checklist](./test/EDITOR_COMPATIBILITY.md) for evidence,
reproduction steps, per-editor blockers and follow-ups. Real-editor acceptance is still open:
Zed is installed but Computer Use access was denied; JetBrains and Neovim were unavailable.

Proposed decisions — pending Indra review:

- Use the same offline sample for automated and GUI verification, with no provider credentials or
  model cost. Fixture-client passes cannot satisfy Zed or independent-editor acceptance. Record
  exact versions and real observations before claiming editor compatibility.
- Preserve framework-adapter scope, application-owned model/credentials, no-op authentication,
  default in-memory sessions and opt-in-only local/editor filesystem and terminal tools.
- Keep editor configs and smoke agents in repository examples; do not add launcher flags, bundled
  coding-agent behavior, provider dependencies or editor-specific runtime branches for verification.
- Missing-auth checks simulate application setup failure. Actual credential validation belongs to
  the host. Verify safe stderr visibility manually; generic wire error UX remains a follow-up.

### ACP 09 implementation status

The test suite now includes a reusable raw ACP fixture client driving the built `anvia-acp`
subprocess, an offline streaming factory, direct support-module tests, real MCP call cancellation,
and opt-in library-host editor callback cancellation. Existing tests cover every runtime module;
the coverage map, reproduction commands and GUI follow-up are in
[test/CONFORMANCE.md](./test/CONFORMANCE.md).

Proposed decisions — pending Indra review:

- Keep ordinary tests offline and credential-free. Run the experimental upstream TCK separately
  with a clean pinned checkout and frozen Python dependencies. Do not add Python or TCK runtime
  dependencies to the published adapter.
- Record a compact per-requirement/per-test report without wire transcripts or stderr payloads.
  Require all mandatory checks to pass, including both cancellation checks; do not accept an
  upstream cancellation skip as sufficient coverage. A passing TCK is not official certification.
- Preserve all prior product defaults: framework adapter, host-owned model/credentials, no-op
  authentication, in-memory sessions, and local/editor tools disabled by default. Opt-in tests use
  a separate library host. Real editor GUI verification remains ACP 10.

The pinned TCK reports CONFORMANT with all 21 mandatory requirements passing. The recorded report
includes unsupported-capability skips and the exact TCK/SDK/schema versions. No protocol or public
runtime behavior changes were needed for ACP 09.

### ACP 08 implementation status

Phase-2 editor tools, config rebuilds, slash commands, text resources and explicit edit diffs are
implemented. Images reuse ACP 03's opt-in validation. No core or Docker package changes are needed:
local and Docker backends use the existing session factory/tool contracts.

Proposed decisions — pending Indra review:

- Keep the framework adapter boundary, application-owned model/credentials, no-op authentication,
  in-memory sessions, and local/editor tools off by default. `editorTools` opts in independently to
  reads, writes and terminals; each is intersected with the client's advertised capability. All
  registered editor tools require approval, and the factory must attach their frozen identities.
  Never retry a denied or failed operation through a different backend.
- Resolve editor paths against canonical session cwd; validate lexical roots and existing ancestors
  (including symlinks) before dispatch. The editor owns access-time policy and unsaved buffers.
  Terminal cwd containment is not a shell sandbox. Use explicit command/argv, no adapter shell/env.
  Bound file text and terminal output to 1 MiB. Always attempt terminal release in `finally`; kill
  first on cancellation or wait failure. Cleanup uses independent two-second signals. Retain late
  create replies to release their IDs; an unresponsive create quarantines execution. Once the
  transport is gone, cleanup is best effort and the editor owns its remaining terminal resources.
- Refine ACP 01's MVP-only prohibition on model switching: phase 2 accepts an explicit host model
  catalog (`models`, first value default), passed through `context.config.model`. No model discovery,
  provider construction or credentials on the wire. Always return the `mode` config option (`ask`),
  and offer `read-only` only with host opt-in. Legacy mode RPC remains unsupported.
- Config changes validate first, cancel any active turn/approval, wait for owned execution to finish,
  then rebuild via the session factory. Block overlapping prompts/config writes while rebuilding.
  Preserve successful history and session-owned MCP clients. Commit only a validated fresh binding;
  dispose failed/late bindings, keep the previous config on rebuild failure, and dispose the old
  binding after a successful swap. Disposal failure disables the session rather than resurrecting
  a disposed binding. Stale approvals and continuations cannot cross this boundary.
- Read-only contexts omit editor writes, terminals and editor MCP servers. Require explicit
  `readOnlyTools` classification for every remaining application tool; preserve approvals.
  Factories must exclude opaque provider-side/dynamic/nested execution with write effects. This
  trusted host contract does not sandbox arbitrary application code. MCP connections remain owned
  by the session and can be used again when switching back to ask.
- Commands are an explicit, fixed host registry of pure synchronous prompt expansions. Announce
  them after creation; dispatch only sole text blocks matching `/name arguments`. Unknown commands
  remain text. Validate original and expanded inputs against normal limits; no built-in shell.
- `embeddedContext: true` accepts text resources as labelled user context (URI is metadata, never
  fetched); reject binary blobs and audio. Image policy remains unchanged.
- `AcpToolPresentation.diffs` supplies proposed old/new text and explicit paths. Omit unknown old
  text; null means a known new file. Bound presentation to 20 diffs / 1 MiB aggregate text and show
  it in pending updates and permission requests. Editor writes supply new-text proposals and
  locations automatically; other tools keep generic kind `other` unless the host projects metadata.
  Never infer a diff from arbitrary raw arguments or claim a proposal was applied after denial.
- Local/Docker tools stay host-owned. Docker uses its own POSIX workdir; `mapSandboxPath` maps an
  explicitly corresponding sandbox root to a host root for display, rejecting traversal. It does
  not mount/copy/synchronize files; the host must establish that correspondence or omit locations.

Headless tests cover opt-in/capability intersections, identity registration, editor denial with no
local fallback, cwd/symlink checks, terminal cleanup including late create replies, config rollback,
read-only classification, approval races, execution quarantine, history preservation, command/config
wire updates, text/image input and diff permissions. Real editor and Docker integration remain manual;
see the README checklist. ACP 16 must document the new options, context config, binding classification,
`AcpCommand`, `AcpSessionConfig`, diff metadata and `mapSandboxPath` externally. Wire contracts follow
[terminals](https://agentclientprotocol.com/protocol/v1/terminals),
[config options](https://agentclientprotocol.com/protocol/v1/session-config-options), and
[slash commands](https://agentclientprotocol.com/protocol/v1/slash-commands).

### ACP 07 implementation status

Editor stdio declarations now connect through session-owned `McpClientGroup` instances before
factory invocation. The factory must attach `context.mcpServers`; core preserves the frozen
approval-wrapped tool identities, which the coordinator validates. No core API changes are needed.
Every setup failure attempts group cleanup and any returned binding disposer; session cleanup
closes both after active execution finishes. Aborted MCP connection rollback now awaits the same
close promise as the initial abort, including stdio process exit.

Proposed decisions — pending Indra review:

- Trust validated stdio declarations from the local editor by default. Add optional host
  `mcp.authorizeServer(server, { cwd, signal })` to restrict normalized declarations before
  connecting any server. It cannot grant execution approval. Use argv without a shell, canonical
  session cwd, SDK platform environment allowlist plus explicit env, piped stdout and inherited
  stderr. Do not spread `process.env`; provider keys must be explicitly supplied to a server.
- Validate the whole declaration list first: nonempty unique names, command/args without NUL,
  env names without NUL/equals, duplicate env names (case-insensitive on Windows), and duplicate
  HTTP headers (case-insensitive). Reject malformed, routing and transport-owned headers. No
  config values or underlying error details cross the ACP error boundary.
- Use existing MCP automatic negotiation explicitly, preserving its standalone pinned default.
  Real subprocess fixtures verify discovery-to-legacy fallback, including the SDK's disposable probe
  process followed by a separate session process. Launch declarations must tolerate two startups.
- Prefix with `mcp_<16 hex SHA-256(server name)>_`. This is stable across sessions and ordering,
  avoids punctuation normalization collisions, and preserves remote names in provenance. Reject
  all final tool-name collisions, including hash collisions and application tools. Require approval
  for every editor MCP tool, regardless of server annotations; no automatic read-only bypass.
- Bound each setup to 32 servers, each catalog to 256 tools / 1 MiB; existing transport bounds
  remain 10 MiB per message. These MCP-specific bounds are fixed for this phase.
- Implement and test Streamable HTTP, but advertise it only with `mcp.http: true`. Add host-owned
  `mcp.trustedHttpEndpoints: [{ url, addresses }]`, backed by the new MCP transport option
  `trustedAddresses`. Refine the earlier origin proposal to an **exact URL** plus pinned IPs.
  Socket lookup uses only host-approved addresses, so DNS rebinding cannot expand trust. Allow
  loopback, RFC1918 and ULA; reject metadata, link-local, mapped IPv6 and reserved ranges. Keep
  strict SSRF protection for every other URL, including OAuth requests; reject endpoint redirects
  and never forward configured headers elsewhere. Close each private dispatcher with its client.
  No global SSRF switch is used. Trust cannot be supplied through editor declarations or `_meta`.
- Request best-effort legacy HTTP session termination on close, using MCP's existing two-second
  deadline. Keep legacy SSE and ACP-proxied MCP unsupported. Library hosts configure policy;
  the dedicated launcher uses defaults (stdio, ask on every tool call, HTTP disabled).

Tests cover real stdio and HTTP servers, both protocol handshakes, cwd/argv/env isolation,
permission allow/reject/cancel with late replies, duplicates and tool collisions, rollback,
factory failure and disconnect during setup, and exact endpoint boundaries. Real GUI verification
remains ACP 10; the README contains its manual checklist. ACP 16 must document `AcpMcpOptions`,
`AcpMcpServer` and `trustedAddresses` externally. Existing ACP 01 product decisions still apply:
framework adapter, host-owned model/credentials, no-op authentication, in-memory sessions, and
local/editor filesystem and terminal tools off by default.

### ACP 06 implementation status

The prompt stays pending across approval and question suspensions. The coordinator passes opaque
public `AgentContinuation` values back through `AgentInput`, with `agent.stream()` for streaming
models and `agent.generate()` for completion-only models. It never reads `continuation.state` or
imports core internals. Completed segment messages accumulate privately and append atomically only
when the entire prompt succeeds. One event mapper retains unfinished calls and execution aliases
across segments while resetting core's segment-local generation numbers. Permission requests,
elicitations and final tool updates share the same editor tool ID.

Proposed decisions — pending Indra review:

- Offer only `allow_once` and `reject_once`. Validate selection against those IDs. Unknown,
  malformed, absent and RPC-error permission responses resume with `approved: false`; an explicit
  cancelled outcome stops the prompt. No always-grant cache exists. Permission presentation uses
  the existing trusted title/kind/locations projection, never raw inputs, reasons or continuations.
- Capture the prompt's pending-request registry before execution. Cancellation/disconnect closes
  it, signals the SDK callback request and ignores late replies. Recheck the active prompt identity
  and abort signal immediately before resumption. A stale approval cannot authorize a later turn.
- Map questions to session/tool-scoped form `elicitation/create` only when the client advertises
  non-null `elicitation.form`. Generate adapter field IDs, require every answer, and validate again
  with core's public interaction validator. Closed choices use titled string enums; custom-answer
  questions use strings. Decline/cancel stops the turn as `cancelled`. Malformed answers or RPC
  failures return sanitized `invalid_interaction_response`. Without form support, return
  `unsupported_interaction`; never fabricate an answer, read terminal stdin, or reuse a later prompt
  as the answer. Applications must use question tools only for non-sensitive information.
- `AcpSessionBinding.turnBudget` optionally supplies `maxModelCalls`, `maxDurationMs`, and
  `maxCost` with `estimateCost(usage)`. Model calls mean logical generation requests, matching
  core's tool-loop semantics; provider retries/structured-output repair attempts remain governed
  by the application's retry settings. Count them across segments with public request middleware.
  The ceiling is the smaller of `maxModelCalls` and `agent.defaultMaxTurns + 1` (normally 21),
  preserving the initial request plus follow-up behavior from ACP 04. Resumed tools may finish
  at that ceiling, but another model generation cannot start.
- Time and cost have no default ceilings. A single wall-clock deadline starts at prompt entry,
  including approval waits. Cost is a monotonic host estimate from cumulative usage, in host-defined
  units; ACP does not guess provider pricing. Check cost after each generation and before resume,
  so the generation that reaches a ceiling has already incurred its cost. Retry usage reported by
  core is included. Budget exhaustion returns `max_turn_requests` and retains prior history only.
  Deadline aborts use the same execution quarantine as cancellation. Neither cost estimates nor
  deadlines undo already-started effects or bound arbitrary work inside application tools.

Headless tests exercise both model modes, multiple approvals in one generation, reused provider IDs,
private history, malformed replies, late cancellation, questions, and budgets across suspensions.
Real editor verification remains ACP 10. External docs in ACP 16 must cover `AcpTurnBudget`,
`turnBudget`, and the form fallback. Protocol shape follows the pinned SDK and
[ACP tool permissions](https://agentclientprotocol.com/protocol/v1/tool-calls) and
[form elicitation](https://agentclientprotocol.com/protocol/v1/elicitation).

### ACP 05 implementation status

`session/cancel` invalidates the active turn's pending requests, aborts its controller and
calls `AgentStream.cancel()` when streaming. Completion-only agents receive the same per-turn
abort signal. Core passes it to provider requests and tool/MCP execution contexts. The original
prompt resolves once with `cancelled`; core `AgentRunCancelledError` is normalized to that
stop reason. Idle, unknown-session and pre-initialization notifications are harmless.
`$/cancel_request` remains SDK-owned request cancellation and does not abort session execution.

Proposed decisions — pending Indra review:

- Cancellation settles the prompt after any update already handed to the transport drains.
  It does not wait indefinitely for application/provider code that ignores abort. The session
  remains busy until that execution finishes, and resource disposal waits for it. This refines
  ACP 01's cooperative-stop rule: protocol settlement and execution ownership are separate.
  Already-started side effects cannot be rolled back or forcibly stopped in-process.
- Drop subsequent text/tool updates and skip late presentation callbacks. No synthetic successful
  or failed tool completion is emitted on cancel; v1 has no cancelled tool-call status, and the
  prompt's `cancelled` stop reason is authoritative. Updates already in flight may still arrive
  before that response.
- Each prompt owns a fresh pending-request registry. Closing it synchronously invalidates queued
  and late replies, aborts callback signals, and rejects further dispatch through stale registry
  references. Future approval/editor bridges must capture that registry for the turn and check
  its cancellation before resuming a continuation. ACP 06 now uses this registry for the permission bridge.
- Cancelled turns never enter private history. Successful history append is the atomic completion
  boundary; cancellation after that boundary is a no-op. Session lifetime signals remain live
  after a turn cancellation, so other sessions and later turns remain usable.
- MCP cancellation is verified with an application-supplied `McpServer` fixture tool using core's
  normal MCP execution path. Existing `@anvia/mcp` tools forward this context signal to their SDK
  calls. Editor-supplied server setup/transport integration stays in ACP 07; real permission and
  editor callbacks stay in ACP 06/08. ACP 05 tests exercise their pending-request foundation.

Verification covers generation (streaming and completion-only), local/MCP tool execution,
late and queued callback responses, late tool events, cancellation before model dispatch,
independent sessions, history preservation, quarantine/disposal, and v1 response cardinality.

### ACP 04 implementation status

`events.ts` consumes `AgentStream.events` exactly once, awaits each normalized update, then
reads `stream.result`. For a generation without text deltas, it projects text from core's
`turn_end` response when no enforced output guardrails exist. With output guardrails, only core's
safe replacement deltas are used: intermediate `turn_end` text may still be unguarded. Already
streamed text is not repeated. Only `wire/v1.ts` constructs SDK `session/update` payloads. The prompt
handler returns one final response after updates and history handling finish; outcomes/error
events never independently settle the RPC or replay already streamed text.

Proposed decisions — pending Indra review:

- Default `reasoning: false`. A library host may opt into plaintext/summary `reasoning_delta`
  updates with `reasoning: true`. Encrypted/redacted reasoning and all signatures remain private.
  Completion-only models project successful run messages after `generate()` finishes; they do
  not project reasoning or raw outcome metadata. With enforced output guardrails, completion-only
  text comes exclusively from the guarded final outcome, not intermediate assistant messages. Nested agent events and provider-side tool
  artifacts remain private until a separate presentation contract exists.
- Allocate tool IDs using the session ID and a session-lifetime counter. Within a prompt,
  correlate partial calls, final calls and results by `(generation turn, toolCallId)`; record
  execution `internalCallId` aliases when results arrive. Provider `callId` is never the primary
  key: multiple local calls can share it, and all IDs may repeat in later generations/prompts.
  Core validates local tool IDs within a generation. Correlation maps are discarded after each
  prompt; the session counter is not reset. ACP 06 preserves correlation across continuation segments with this mapper.
- A partial or final tool call emits `pending`, then its result emits `completed` or `failed`.
  `execution-denied`, `error-text` and `error-json` all mean `failed`. No `in_progress` is
  fabricated from a model call event: that event can precede approval or execution. Tool raw
  input/output and error details are omitted. Basic titles default to the tool name (or
  `Tool call`), unknown kinds to `other`, and locations to empty.
- A binding may supply `toolPresentation(call)` returning `AcpToolPresentation` with a public
  title, kind and locations. It runs on complete calls only. Titles are stripped of controls
  and limited to 200 characters; at most 100 locations are displayed, relative paths resolve
  against the session cwd, and invalid lines/control-containing paths are omitted. Locations
  are display metadata, not filesystem access or authorization. This trusted host callback
  must avoid secrets; callback errors become sanitized `execution_failed` errors. Diffs and
  richer tool content remain ACP 08 work.
- Input/output guardrail blocked outcomes and provider `content-filter` finish reasons map
  explicitly to `refusal`. Core's streamed public refusal text is forwarded normally; internal
  guardrail reasons, rule IDs and decision metadata are never projected. The adapter does not
  replay blocked outcome text. Output guardrails own buffering/replacement before deltas reach
  this adapter; this layer cannot retract earlier output or tool effects.
- `length` maps to `max_tokens`, `MaxTurnsError` to `max_turn_requests`, and other completed
  responses to `end_turn`. Unexpected stream, presentation and notification errors go through
  the existing safe JSON-RPC error boundary. Core currently allows the initial model request
  plus `maxTurns` follow-ups; ACP 04 preserves that behavior. Continuation budgeting is ACP 06.

Verification includes real Agent streams, delayed notification sinks, v1 byte-stream fixtures,
completion-only projection, reused IDs across generations/prompts/sessions, all tool result
failure variants, input/output refusals, reasoning privacy, mid-stream failures, and exactly one
terminal response. No editor GUI compatibility is claimed by these headless checks.

### ACP 03 implementation status

`session/new` validates an existing absolute directory, canonicalizes symlinks, checks optional
host `workspaceRoots`, reserves capacity during setup, and calls the factory once. Each record
owns an immutable cwd/capability/policy snapshot, fresh agent, empty MCP connection/tool slots,
private `MemoryStore`, prompt lock, and bounded pending-editor-request registry. No code changes
the process cwd. Factories must resolve application tool paths using their context cwd.

`session/prompt` validates all content before model execution and rejects overlap with
`session_busy`. It uses `Agent.stream()` with one consumer for streaming models and `generate()`
for completion-only models. ACP 03 originally returned only the final stop reason; ACP 04
adds the output projection described above. ACP 06 now bridges approvals/questions; ACP 05 implements cancellation, while editor MCP
connections remain ACP 07 work. Nonempty MCP declarations are explicitly rejected before the factory runs.

Proposed decisions — pending Indra review:

- Use a private, scope-checked in-memory `MemoryStore` per session, managed by the adapter.
  Pass loaded history plus the new user message through `AgentInput.messages`; append only
  successful outcome messages once. Core outcomes contain this run's messages, excluding prior
  input history. Reject agents with separately configured memory or structured output.
- Implement optional image conversion in ACP 03 to meet its acceptance criteria. `images: true`
  advertises support and requires an image-capable model from every factory result. Defaults
  remain text/resource references only. Accept canonical base64 PNG, JPEG, GIF and WebP payloads;
  never fetch image URIs. Image decoding/format recognition belongs to the model provider.
- Default limits per connection: 32 sessions including setup. Per session: 16 pending editor
  requests, 1,000 history messages and 16 MiB serialized history. Per prompt: 256 blocks,
  10 MiB aggregate text/encoded-image bytes, 1 MiB aggregate UTF-8 text (including rendered
  resource references), 5 MiB decoded per image. The independent 10 MiB wire-frame limit still
  includes metadata. Hosts can override positive integer limits with `limits`.
- Reject history overflow atomically without truncating tool pairs or evicting old turns. A
  completed response that exceeds the history budget fails the prompt and retains prior history;
  already executed application effects cannot be undone. Failed, blocked, suspended and
  max-turn-exhausted runs retain prior history only. A full session needs a new session/connection.
- No persistence, idle eviction or session close/delete RPC yet. On connection close, abort setup,
  active runs and pending requests, clear history, and dispose bindings once. Dispose late factory
  bindings too. Library close waits for cooperative factories/runs/disposers to settle; the existing
  launcher timeout bounds process shutdown. Application/provider transient allocations and tool
  outputs during a run are not a heap quota; output queue hardening remains later work.
- Pending editor requests reserve slots before dispatch and reject late replies after teardown.
  ACP 03 makes no editor requests itself; later bridges must use this registry.

### ACP 02 implementation status

`createAcpConnection` and `serveStdio` expose `closed` and idempotent `close()`. The launcher
`anvia-acp <module-path>` loads trusted JavaScript modules exporting a named/default session
factory or Anvia agent. It reserves protocol stdout before import and redirects console/direct
`process.stdout.write` logging to stderr. The library leaves process logging/signals to its host.
At ACP 02 only `initialize` and `authenticate` were registered. No factory
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

| Question                     | Proposed decision and consequence                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product shape                | Framework adapter. Applications supply an Anvia agent factory; no bundled coding agent, provider SDK, or default model.                                                                                                                                                                                                                                                        |
| Model and credentials        | The application configures both through its own Anvia agent/provider setup. Advertise `authMethods: []`; a schema-valid `authenticate` is an idempotent no-op returning `{}`. Never collect credentials through ACP, infer a login flow, or expose provider secrets. Missing provider credentials produce a sanitized configuration error, not an editor login challenge.      |
| Session persistence          | An adapter-owned in-memory session store by default. Records and multi-turn context last only for the connection lifetime. Do not select SQLite or an application `MemoryStore` implicitly.                                                                                                                                                                                    |
| Local/editor fs and terminal | Off by default. Local tools require explicit application registration; editor-backed tools require explicit opt-in plus the corresponding client capability. Advertising a capability alone grants no permission.                                                                                                                                                              |
| Modes/config options         | Permission presets on the same agent first: `ask` by default and optional `read-only`. No model switching in the MVP; ACP 08 adds host-catalog model selection. Prefer config options; legacy modes, when exposed, alias the same preset. `read-only` admits only application-classified reads, and still honors an existing approval requirement. Unknown effects are denied. |
| Disconnect                   | Cancel all active turns and pending interactions, invalidate continuations, and dispose connection-owned sessions/resources. Never continue in the background or accept a late approval. Already-started side effects may have happened; do not retry them automatically.                                                                                                      |
| Cross-process restore        | Not required for the first v1 MVP. No load/resume/list/close/delete advertisement until ACP 11 implements and tests each operation. Persistent history does not imply resumable execution.                                                                                                                                                                                     |
| Permissions                  | Offer `allow_once` and `reject_once` only. No “always” grant cache, across either turns or sessions. Application tools retain `requiresApproval`; editor and client-supplied MCP tools require approval by default.                                                                                                                                                            |
| Concurrency                  | One active prompt per session; reject overlapping prompts rather than queueing. Different sessions may run concurrently with isolated cwd, histories, callbacks, and tool IDs.                                                                                                                                                                                                 |
| Runtime                      | Direct `Agent.stream()` / `generate()` by default; optional durable binding in ACP 12. `anvia acp` reuses the launcher (ACP 13); a client-side adapter and remote transport remain later tasks.                                                                                                                                                                                |
| Content/privacy              | Text and resource-link references by default; images are an explicit host opt-in from ACP 03. Embedded context and audio remain unsupported. Suppress reasoning by default; ACP 04 permits explicit plaintext live-update opt-in. Never expose signatures or replay reasoning.                                                                                                 |

An application can provide trusted custom tools that do arbitrary work. This adapter is not
a sandbox for application code. Permission presets govern registered operations; they cannot
retroactively classify or constrain unmediated provider-side tools. Do not offer `read-only`
for an agent with execution paths whose effects cannot be enforced.

## Session factory API

The factory is called for each successful `session/new` and config rebuild, after validating the absolute
cwd, authorizing MCP configuration, and connecting session-owned MCP clients. It receives
Anvia tool/server contracts and a normalized capability snapshot, never the raw SDK connection.
It returns a fresh agent for each binding and an optional cleanup callback. Provider clients
may be shared by the application; mutable agent/session state may not.

Original TypeScript surface sketch (see `src/types.ts` for compiled APIs and ACP 08 config fields):

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

Default history is adapter-managed through a private `MemoryStore`: start a turn with
`Agent.stream({ messages, ...settings })` (or `generate` for a completion-only model), using
loaded history plus the new user message. Reject independently configured agent memory to avoid
duplicate or shared history. The coordinator uses an isolated `MemoryScope` when loading and
appending, and commits each successful run's messages once. Core outcomes exclude prior input
history; do not slice those outcome messages by the prior history length. ACP session records and
model history remain separate contracts. Failed or suspended runs retain prior committed history
only; never carry an unanswered tool invocation into a fresh model request.

## Capability matrix

“MVP” is the target after ACP 02–07, not functionality shipped by this document. Implemented
handlers, host opt-in, and client capabilities must all agree before advertising/using a feature.
Absent optional capabilities mean unsupported; no optimistic probing or silent downgrade.

| ACP surface                                      | MVP target                                      | Later work / gate                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `initialize`                                     | v1, agent identity, conservative capabilities   | SDK/schema upgrades are explicit                                                                                         |
| `authenticate`                                   | No-op; `authMethods: []`                        | Custom auth would need a separate contract                                                                               |
| `session/new`                                    | Absolute cwd, fresh agent, stdio MCP            | Policy validation before effects                                                                                         |
| `session/prompt`                                 | Pending until the whole turn ends               | No premature response at an approval suspension                                                                          |
| `session/cancel`                                 | Abort active turn; settle prompt as `cancelled` | Idle/unknown-session notification is harmless                                                                            |
| `session/update`                                 | Text, tool start/progress/result                | Basic title/kind/locations in ACP 04; rich diffs in ACP 08; plan/usage remain future work; never fabricate provider data |
| `session/request_permission`                     | Once-only approval bridge                       | No always-allow/reject options                                                                                           |
| Text / resource links                            | Supported; links remain references              | No implicit URI fetching                                                                                                 |
| `promptCapabilities.image`                       | `false` by default; host opt-in from ACP 03     | `images: true` requires a compatible model in every factory result                                                       |
| `promptCapabilities.embeddedContext`             | `false`                                         | ACP 08: validated text resources                                                                                         |
| `promptCapabilities.audio`                       | `false`                                         | Future explicit conversion policy                                                                                        |
| Stdio MCP                                        | Supported, per-session ownership                | Required ACP transport; no capability flag                                                                               |
| `mcpCapabilities.http` / `.sse`                  | HTTP opt-in; SSE `false`                        | ACP 07 tests HTTP and exact endpoint trust; legacy SSE unsupported                                                       |
| Client `fs.readTextFile` / `fs.writeTextFile`    | Unused; tools off                               | ACP 08: opt-in, separate client flags and workspace policy                                                               |
| Client `terminal`                                | Unused; tools off                               | ACP 08: opt-in, lifecycle and cancellation cleanup                                                                       |
| `session/set_config_option` / `session/set_mode` | Unadvertised and unavailable                    | ACP 08: config options rebuild safely after cancellation; legacy mode RPC unsupported                                    |
| `available_commands_update`                      | No commands advertised                          | ACP 08: explicit application command registry                                                                            |
| `elicitation/create`                             | ACP 06: validated forms for capable clients     | Without form support: `unsupported_interaction`; no fabricated answers or stdin prompts                                  |
| `loadSession`                                    | `true`                                          | ACP 11: safe replay without model/tool execution                                                                         |
| `sessionCapabilities.resume/list/close/delete`   | Supported; list/delete gated by store methods   | ACP 11: advertise each only with working store semantics                                                                 |
| v2 / remote transports                           | Unavailable                                     | Separate adapters/tasks, never implicit fallback                                                                         |

The original MVP `initialize` response had `protocolVersion: 1`, `authMethods: []`,
`loadSession: false`, all three optional prompt flags false, both optional MCP flags false,
and empty `sessionCapabilities`, alongside `agentInfo`. ACP 11 now advertises the implemented
session lifecycle methods as described above. Client fs/terminal flags are inputs,
not agent capability claims. These field names follow the
[initialization contract](https://agentclientprotocol.com/protocol/v1/initialization).

## Content and presentation policy

Preserve prompt block order. Validate the complete prompt before adding history, invoking a
model, or resolving resources. Unsupported blocks fail the whole prompt with invalid params;
never silently omit context. Text maps to Anvia user text parts. A resource link maps to a
clearly labelled user-context reference containing its URI, name, and supplied description;
it does not authorize a file read, HTTP request, or MCP resource read.

When enabled with `images: true`, base64 images map to Anvia image parts after MIME and
decoded-size checks. Opt-in embedded text resources become labelled user-context text, never system instructions. Binary
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
requests, system prompts, continuations, non-opted-in reasoning, signatures, raw provider responses, or
credential-bearing tool inputs. Public text and sanitized tool summaries form an allowlisted
projection for future replay. Redact error details and permission presentation as well.

## Permissions, turn completion, and cancellation

Use Anvia's `requiresApproval` and `AgentInteractionOutcome`/`AgentContinuation`; the adapter
must not execute a suspended tool directly. On approval suspension, emit its pending tool
state, request permission, validate the returned option ID against this request, then resume
with `{ continuation, response: { type: "tool-approval", approved } }`. Denial resumes with
`approved: false` so the model can explain or choose another operation. An absent, malformed,
cancelled, or failed permission reply never authorizes execution. A cancelled permission ends
the turn as cancelled; malformed replies resume with a rejection. No continuation crosses sessions.

Keep one ACP prompt pending across all continuation segments. Count model requests and usage
across segments, not once per `Agent.stream()` call; a continuation cannot reset the turn budget.
Use the configured agent limit plus the initial generation as a whole-prompt ceiling, optionally
lowered by `turnBudget.maxModelCalls`. ACP 06 uses public middleware to count generations across
segments; it never inspects or mutates opaque `continuation.state`. Exhaustion maps to
`max_turn_requests`, even after multiple approval cycles.

Each active turn has an abort controller and generation token. Cancellation invalidates pending
permission/question callbacks synchronously; immediately before resumption and tool execution,
check both the token and abort signal. Drop late replies/updates. An idle cancel is a no-op.
An explicit `session/cancel` resolves the original prompt exactly once with `cancelled` after
already-dispatched updates have drained; it is not an ordinary RPC error. ACP 05 retains the
session lock and resource ownership until any uncooperative execution finishes.
See [prompt completion and cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn).

Disconnect (EOF, broken output, explicit connection close, or launcher shutdown) follows that
same invalidation path for every session. A broken transport cannot receive a prompt response;
settle local completion and release resources without trying to reconnect or resume. Allow a
5-second cleanup grace period by default, then the launcher terminates its owned resources.
For in-process tools that ignore abort, quarantine the affected session until execution settles;
never unlock it for another prompt or claim the side effect was rolled back. A library cannot
kill arbitrary caller code. Editor terminal cleanup is best effort once the connection is gone.

Permission presets cannot override an application's stricter `requiresApproval` or workspace
restriction. ACP 08 config changes cancel active execution and wait for it to settle before rebuilding. They
cannot enable host-disabled backends and take effect atomically at the next prompt. Do not implement an always-allow mode.

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

ACP 07 implements opt-in HTTP with strict URL safety by default and exact host-configured URLs
plus pinned IP addresses for private access (see implementation decisions above). No trust comes
from editor declarations. Legacy SSE stays unsupported. Neither server configs nor environment/header
values belong in transcript replay or error data.

## Error model

The wire adapter translates normalized errors into SDK responses. Use standard codes from the
[ACP schema](https://agentclientprotocol.com/protocol/v1/schema); keep Anvia-specific reasons
in a small `data.kind` field, not invented global numeric codes.

| Condition                                                                   | Wire behavior                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Malformed JSON / invalid envelope                                           | SDK parse error `-32700` / invalid request `-32600`                                                              |
| Method unavailable or not implemented                                       | Method not found `-32601`                                                                                        |
| Invalid cwd, content, config value, or MCP declaration                      | Invalid params `-32602`; safe kind such as `invalid_cwd` or `unsupported_content`                                |
| Request before initialization, duplicate initialization, overlapping prompt | Invalid request `-32600`; kind `not_initialized`, `already_initialized`, or `session_busy`                       |
| Unknown/closed session on a request                                         | Resource not found `-32002`; kind `session_not_found`                                                            |
| Host policy rejects setup                                                   | Invalid params `-32602`; kind `policy_denied`; no side effects                                                   |
| Factory, MCP connection, or provider failure                                | Internal error `-32603`; kind `configuration_error`, `mcp_connection_failed`, or `execution_failed`              |
| Tool execution failure                                                      | Failed tool update/result; let the agent handle it when possible                                                 |
| Unsupported interaction / invalid question response                         | Internal error `-32603`; kind `unsupported_interaction` / `invalid_interaction_response`; never execute the tool |
| Cancelled prompt                                                            | Successful prompt result with `stopReason: "cancelled"`                                                          |
| Other request aborted during shutdown                                       | Request cancelled `-32800` if transport is still writable                                                        |
| Normal response / token limit / turn budget / guardrail refusal             | `end_turn` / `max_tokens` / `max_turn_requests` / `refusal`                                                      |

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
  guardrails, and MCP currently need additional checkpoint support. The optional ACP 12 driver preserves these restrictions.

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
