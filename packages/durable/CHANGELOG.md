# @anvia/durable

## 0.16.0

### Minor Changes

- e96c650: Add `hooks: { mode: "record", hook }` to the registration. It admits a core control hook (`onToolCall` skip, terminate and approval request, `onRunStart` and `onCompletionCall` cancel) and records each decision before it is applied, so a restart or retry reuses it and never calls the hook again.
- 2654ab0: Add `context: { mode: "recorded" }` to the registration. It admits an agent with a live `VectorContext`: each retrieval is recorded before the model call and reused on replay, and the context settings are fingerprinted per run.

  An oversized retrieved document set is stored in the blob table behind a whole-value reference, so one retrieval cannot exceed the operation payload limit. The peer dependency on `@anvia/core` now requires execution protocol 5 (`>=1.19.1 <2`), since the runtime refuses older core anyway.

## 0.15.0

### Minor Changes

- 14a3e9c: Add `toolConcurrency` to `DurableAgentRegistration` so the tool calls of one model turn can run concurrently. It is validated, forwarded to every run of the agent, and reported by `compatibility()`.

## 0.14.0

### Minor Changes

- 887dd02: Keep `status` events small: they no longer embed the run's outcome.

  - `@anvia/durable`: a `status` event carries `status`, `error`, `blockedOperation` and
    `nextAttemptAt`. The run's `outcome` is stored once, on the run, and is read from the run
    snapshot. Status events are not payload-checked, so a limit cannot block a run from reaching a
    terminal status. Journals written by older versions still carry `outcome` on the event, and
    clients still read it.
  - `@anvia/client`: the durable chat transport reads the outcome from the snapshot when a settled
    (`completed`, `waiting`, `failed`) status event has none. If the run has already moved past that
    status, the event maps without an outcome. The chat output for completed, waiting and failed
    runs is unchanged.
  - `@anvia/server`: peer range updated for `@anvia/durable` 0.14.

- bf0a3bc: Allow a recorded memory run to pause for a human interaction. The paused segment's memory writes are flushed before the run waits. Core does not read memory on resume, so no message is offered twice. The resumed segment's writes use keys under the next epoch and are based on the version the previous segment left behind, so a writer that commits during the pause makes the resume `needs_attention` instead of overwriting it. Such a run used to fail with a `TypeError`.
- 01f9f4c: Admit observational lifecycle hooks. Set `lifecycle: { mode: "observe" }` on a registration and the agent's `onStart`, `onStepFinish`, `onToolStart`, `onToolFinish`, `onFinish` and `onError` hooks run at most once per step. Each invocation is recorded before the hook runs, so a restart or retry does not repeat it. A throwing hook is recorded and does not fail the run. Without the marker, `lifecycle` is still rejected at registration.
- 803c42f: Accept per-field payload budgets in `maxPayloadBytes`.

  - `@anvia/durable`: `maxPayloadBytes` takes either a number (one budget for every field, as before)
    or an object with `prompt`, `operation`, `event`, and `outcome` budgets. Each omitted group falls
    back to `default`, which defaults to 1,048,576 bytes. `runtime.limits()` returns the resolved
    object. Payload errors keep their fields (`code`, `field`, `limit`, `actual`), and `limit` is the
    effective budget for that field. Unknown keys and non-positive values are rejected at open.
  - `@anvia/server`: the startup body-limit warning compares `maxBodyBytes` with the largest per-field
    budget, so it reads the new shape. The warning text for a number is unchanged.
  - Docs: `durable-operations.md` has the field-to-budget table and notes that a prompt is also
    copied into the history and outcome.

- 1edefb8: Admit MCP servers behind an explicit marker (parity phase 6).

  - Registration accepts `mcpServers: { mode: "pinned" }`. Without it, MCP servers are still rejected,
    and the error names the marker.
  - The run stores a fingerprint of each server (name, server info, capabilities, instructions, and
    each tool's names and definition) at submission. A changed tool list under the same registration
    version fails the run with `needs_attention` before any model call.
  - Each MCP call is an ordinary tool operation with the registration's `toolRecovery` policy (default
    `manual`). An interrupted call blocks for reconciliation.
  - Discovery stays in the application (`McpClient.connect()`); durable does not call `listTools`.
  - Pinned agents are registered in `DurableRuntime.open()`, which computes their fingerprint before any
    run starts. `registerAgents()` rejects a pinned agent, because the fingerprint reads tool definitions
    that may be asynchronous. Owned agent task children and graph tasks record the same fingerprint.

- b64163d: Admit middleware and guardrails. Set `middlewares: { mode: "pure" }` on a registration to admit the agent's middleware, which must be deterministic and free of external effects; replay compares the transformed request or tool input with the persisted one and fails with a recovery error if it changed. Set `guardrails: { mode: "record" }` to admit guardrail policies: each check's outcome is recorded before it is applied, and a restart reuses it. A blocking input decision is a terminal outcome. A check that threw is run again after `retry()`. Two checks with the same id in one policy are rejected at registration. Without the markers both features are still rejected at registration, and the error names the marker.
- 4482e82: Admit agent memory behind an explicit marker (parity phase 7).

  - Registration accepts `memory: { mode: "recorded" }`. Without it, memory is still rejected, and the error names the `memory` field and the marker.
  - The run reads the memory store once, before the first model call, and reuses that snapshot on replay.
  - Each write is a `memory` operation keyed by an idempotency key the runtime derives from the run and the write's position. Writes run after the terminal checkpoint, and a crash before they finish keeps the run open until they do.
  - A concurrent change to the memory history fails the run with `needs_attention` and writes nothing.
  - Rejected under the marker: `memory.compaction`, and a store without `loadVersioned()`. A run that pauses for a human interaction fails under the marker. Adapter packages do not implement the versioned contract yet.

- bea47fa: Admit dynamic tool indexes behind an explicit marker (parity phase 5).

  - Registration accepts `toolIndexes: { mode: "recorded" }`. Without it, tool indexes are still
    rejected, and the error names the marker.
  - Each model call's tool selection is recorded before the call. A restart or retry offers the
    recorded tools and does not run the index search again.
  - The run stores a fingerprint of the indexes (search settings and tool definitions) at submission.
    A change under the same registration version fails the run with `needs_attention`. The embedding
    model is not part of the fingerprint, so bump the version when it changes.

- 2ab41f5: Add `run.resolveMemoryWrite(operationKey, "applied" | "discarded")` and `DurableRuntime.resolveMemoryWrite()`. A recorded memory write that blocked a run, because the store reported a conflict or its outcome is unknown, can now be settled by an operator. `"applied"` says the store already holds the messages, `"discarded"` drops them, and the run sends its remaining writes without a version check and completes. `retry()` still only sends the same write again.
- 519d170: Admit provider-executed tools. Set `providerTools: { mode: "stateless" }` on a registration to admit the agent's `ProviderTool` entries; the provider must keep no state between calls. The definitions are part of the persisted model request, so a changed definition under the same version fails replay with `needs_attention`, and a restart reuses the persisted provider response. A provider tool whose configuration is not JSON is rejected at registration. Without the marker, provider tools are still rejected at registration, and the error names the marker.
- b9e98c5: Accept static `Document` context in durable agents (parity Phase 1).

  - Registration no longer rejects an agent `context` that contains only static `Document` entries.
    `VectorContext` entries are still rejected, with the same message naming `context`.
  - The resolved documents are snapshotted into the run record at submission (`contextDocuments`,
    with a content hash), so a restart or retry replays exactly the same context. Large document sets
    persist through the blob table; the hash stays inline.
  - At every execution start the runtime re-hashes the registration's current documents and compares
    them with the run's snapshot. A mismatch under the same registration version fails the run with a
    `DurableRecoveryError` (status `needs_attention`) naming both hashes, instead of silently changing
    context. Restoring the original documents and calling `retry()` resumes the run.

- b9e98c5: Store oversized payloads as blob references instead of failing the run (DUR-05).

  - The SQLite schema moves from version 9 to 11, adding an `anvia_durable_blobs` table. The table is
    created on open and existing stores (versions 1–10) migrate on ownership acquisition, keeping all
    runs readable. Backup/restore accepts versions up to 11.
  - Tool results, model results, run outcomes (text, output, and messages), exhaustion transcripts,
    context-operation transcripts, and large message leaves (text, reasoning, image/file data,
    tool-call inputs, tool-result outputs) larger than 64 KiB move to the blob table, inside the same
    transaction as the record that references them. Journal records keep a bounded, content-addressed
    reference (`anvia:blob` markers), so an oversized tool result or model outcome no longer fails a
    run or inflates session history.
  - Execution is unchanged for models and tools: requests sent to the provider and results returned
    to the agent loop are always fully restored from the blob table. `run()`, `snapshot()`,
    `operationRequest()`, and event reads hydrate references as well. Replay comparisons run on the
    deterministic stored forms, so a replayed run produces byte-identical references.
  - `DurableTransaction` gains `putBlob`/`getBlob`. Payload limits still apply to the stored
    (bounded) forms; blob writes themselves are not limit-checked.
  - Not covered: media in submitted prompts still counts against the prompt budget at admission, and
    blobs are never garbage-collected (there is no retention yet).

### Patch Changes

- 393e691: Stop user data shaped like blob references from being read as references.

  - Data containing `anvia:blob`, `anvia:blobs`, or `metadata.anvia.durableBlobs` used to be
    interpreted as a reference: a missing blob threw, and an existing hash returned another blob's
    content. Those keys are now escaped when a record is written (a leading `~`) and restored when
    it is read, so the data round-trips unchanged. Only runtime-created references are interpreted.
  - The SQLite schema moves from version 10 to 11. Opening a version 10 or older store rewrites its
    journal rows once: user keys are escaped, well-formed references whose blobs exist are kept, and
    message histories are re-hashed with their references renamed. Maintenance and backup accept
    version 11.
  - Known limit: in rows written before this version, a user object that copies an existing blob's
    marker (same hash and size) cannot be told apart from a real reference.

- 2c5dc61: Drop the "experimental" label from the lifecycle, middleware, guardrail, provider tool, MCP and tool index marker docs. The markers are unchanged and their behaviour is the same.
- b693331: Serialize each payload once per limit check.

  - A completed task output is measured once. The change check used to serialize the whole outcome,
    and the size check then serialized the output again.
  - Every value is serialized at most once per check, and the change check and size check share that
    string. No stored format or limit changes. Status events are still not payload-checked.

- 2ab41f5: Document that the SQLite, Postgres, Prisma and Drizzle memory adapters implement the versioned contract that recorded memory needs. Adds end-to-end tests of recorded memory against the SQLite adapter and a process-kill test of a memory write. No behaviour changes.
- bf0a3bc: Reject a registration that sets both `compaction` and `memory: { mode: "recorded" }`. Registration compaction works on the run's history, which recorded memory keeps in the memory store, so the policy would silently do nothing.
- 7bd64bf: Correct the recorded memory docs. The README no longer says durable session history always replaces agent memory, and the bundled `anvia-durable` skill names the `memory: { mode: "recorded" }` marker. No behaviour changes.
- 2ab41f5: Reject recorded memory agents in graph tasks and owned agent tasks at admission. They run under a synthetic session id, so the agent would read an empty history and write to a scope no caller names. `submitGraph()` throws a `TypeError` naming the agent, and `spawnAgent` fails the task with the same message. Submit the agent with `runtime.submit()` instead.
- d1127b7: Document the effective payload budget per field, and stringify each field once per write.

  - Docs: `durable-operations.md` gains a per-field budget table and says that status events are not
    payload-checked and duplicate the outcome. The stale "no startup warning" sentence is replaced
    with the current `createDurableHandler` warning.
  - Limit checks serialize each persisted field once per write, not up to three times. Behaviour and
    error metadata are unchanged.
  - Test: a single over-limit write names the field, the limit, and the actual size.

- acd260a: Store oversized prompts as blob references instead of inline JSON.

  - A submitted prompt above 64 KiB is written to the blob table. The run record, its `input`
    messages, and the `submitted` event keep a bounded reference. The run and its events read back the
    full prompt, after a restart too. Prompts below the threshold stay inline, as before.
  - Prompt byte budgets still apply to the logical prompt, so admission does not change.
  - The SQLite schema moves from version 11 to 12. Opening a version 11 or older store rewrites its
    oversized prompts once. Maintenance and backup accept version 12.

- 4a3aa88: Warn when the durable HTTP body limit is below the payload limit, and send `Retry-After` on capacity
  rejections.

  - `@anvia/server`: `createDurableHandler` logs one warning at creation when `maxBodyBytes` is below
    the runtime's `maxPayloadBytes`. The default 64 KiB body limit is below the default 1 MiB payload
    limit, so the warning appears for default setups. It is advisory only: it never throws and the
    defaults are unchanged. The check is exported as `durableBodyLimitWarning` for tests and tooling.
    No warning is given when the runtime does not report its payload limit (older `@anvia/durable`).
  - `@anvia/server`: capacity rejections (`code: "capacity_exceeded"`) return `429` with an integer
    `Retry-After: 1` header. This is a conservative hint, not a guarantee. Payload rejections (`413`)
    do not send it.
  - `@anvia/durable`: add a read-only `runtime.limits()` that returns a copy of the effective limits
    after defaults. The server uses it for the startup check. This is additive, so it is a patch.
  - `@anvia/client`: `DurableHttpError` gains `retryAfterSeconds`, read from an integer `Retry-After`
    header, so callers can back off on capacity 429s.

## 0.13.0

### Minor Changes

- 24860e6: Make the durable agent contract honest for agent-level retries and unsupported features.

  - Registering an agent whose resolved options define `retries` now throws a `TypeError` naming the
    agent and pointing at the registration's `modelRetry`. Previously the runtime forced
    `retries: false` on every run, so the setting looked effective but never applied. `retries:
false`, `retries: 0`, and `retries: { maxAttempts: 1 }` are accepted because they never retry.
  - The combined registration rejection now lists only the feature groups the agent actually sets
    (memory, lifecycle, middleware, guardrails, context, MCP servers, provider tools, tool indexes)
    instead of all eight.
  - Add `runtime.compatibility()` and the `DurableRuntimeOptions.onCompatibility` callback, which
    report `agentId`, `version`, static tool names, `streaming`, `compaction`, `modelRetry`, `frozen`
    agent options, and the per-run settings durable does not expose. The callback fires after
    `open()` and after each successful `registerAgents()`, and every report is a detached copy.
  - Document that `skills` are supported because they flatten into static instructions and tools.

  No new agent features are supported; this release makes rejection and reporting explicit.

- 3eca2cb: Make payload-limit admission honest and stop losing session history.

  - A run that cannot start because its prompt, input, or inherited history exceeds
    `maxPayloadBytes` now ends in terminal `failed` instead of parking in
    `needs_attention`. `run.result()` rejects with `DurableRunError` (`status: "failed"`) and
    the event stream ends, so no supervisor action or stuck SSE subscription is left behind.
  - `retry()` of a run whose admission rolled back recomputes the inherited history from the
    session's latest settled run and persists it before execution. If the history still does
    not fit, `retry()` rejects with the same `DurableLimitError` and the run stays failed; a
    retry never executes with a shorter history (previously it ran with only the prompt and
    silently truncated the session).
  - `DurableLimitError` gains `code` (`"payload_too_large" | "capacity_exceeded"`), `field`,
    `limit`, and `actual`. Messages name the offending field and byte counts, for example
    `Durable payload byte limit exceeded: run.input is 2048 bytes; limit is 2000 bytes.`
  - `createDurableHandler` maps payload limits to HTTP 413 and capacity to 429, returning
    `{ error, code, field? }`. The body-too-large 413 also reports the `maxBodyBytes` limit.
  - `DurableHttpError` in `@anvia/client` now exposes `status`, `code`, `field`, and the
    server's error message instead of discarding the response body.
  - Docs state which limit applies to what, that the HTTP body limit is the binding ceiling for
    uploads, and that an over-limit admission is a terminal failure.
  - `@anvia/server` and `@anvia/client` widen their optional `@anvia/durable` peer range to
    `^0.13.0` so the new minor line stays resolvable.

## 0.12.2

### Patch Changes

- 46e6f4f: Update upstream runtime dependencies to their latest releases, including `@anthropic-ai/sdk` and `@anthropic-ai/vertex-sdk` 1.x, `@mistralai/mistralai` 3.x and `@langfuse/otel` and `@langfuse/tracing` 6.x. The `zod` peer range is now `^4.6.7`. `@anvia/jev` adapts to `@typesafe-ai/sdk` 0.7, which no longer accepts a `null` state.

## 0.12.1

### Patch Changes

- 978458e: Port the aven-harness settled-history and model-pricing fixes into source. Durable sessions now continue from started failed/cancelled runs and carry their settled progress (exhaustion tail or latest context checkpoint) into the next run's history instead of dropping it. OpenAI model listing now preserves advertised `pricing` metadata alongside `reasoning`.

  Preserve completed tool exchanges after failed approval continuations, using saved model requests
  when loop compaction is disabled. Omit unfinished tool exchanges from inherited history so a new
  submission never receives a pending tool call without its result.

## 0.12.0

### Minor Changes

- 4015eca: Group durable work under an application-chosen observability session. Durable `trace` options accept `sessionId`, which observers such as Lens use to group traces, for example every turn, goal round, subagent, retry, and resumed attempt of one chat. Task-owned runs, including goal rounds and spawned subagents, use the root task's value. It only affects observers: execution sessions, histories, and ownership stay separate, each run keeps its own trace, and `metadata.durableSessionId` records the execution session when the two differ. Without it, the submitted session is used as before. Application `trace.metadata` keys named after runtime-owned durable keys (`durableRunId`, `durableEpoch`, `durableSessionId`, `durableTaskId`, `durableRootTaskId`, `durableGraphId`) are now always dropped, so they cannot pose as runtime identifiers on runs where the runtime does not set them. `createDurableHandler()`'s `trace(request, resource)` hook can return it. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.12.

## 0.11.0

### Minor Changes

- d65e000: Trace durable runs cleanly in Lens and other observers. Every execution of a durable run (model retries, crash recovery, explicit retries, and resumed interactions) now shares one trace ID derived from the run ID. The trace is grouped under the submitted session, including task-owned, goal, and graph agent runs, and carries `durableRunId`/`durableEpoch` (plus task or graph IDs) in its metadata. `submit()`, `submitTask()`, `submitGoal()`, and `submitRegisteredTask()` accept an optional `trace` (`name`, `userId`, `tags`, `metadata`, `version`, up to 16 KiB).

  Core's execution protocol gains an optional `replayed()` query. Model, tool, and context steps restored from a checkpoint no longer start observer spans or add to observer-reported usage, so a recovered run no longer shows phantom tool spans or duplicated token usage. `@anvia/otel` records `anvia.run.id` when a run starts, so failed or interrupted runs can still be correlated.

  `@anvia/server`'s `createDurableHandler()` gains a `trace(request, resource)` option to set trace context for authorized submissions. HTTP clients cannot set `trace` themselves, so `@anvia/client` submission types omit it. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.11.

## 0.10.0

### Minor Changes

- c2d1454: Add continuing goal rounds. `defineGoal({ rounds: "continue" })` keeps one conversation across a goal's sessions: each session after the first continues the previous session's conversation, including a turn-limited session's partial work, with a short continuation prompt. Assessors receive `session.roundMessages` with only the round's own messages, so an application can let the agent declare completion itself. Owned agent children accept `continueFrom` to continue a finished sibling's conversation. The default `rounds: "fresh"` is unchanged. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.10.

## 0.9.0

### Minor Changes

- c4254d4: Add running-goal controls. Goals now read indexed `pause:N`, `edit:N`, and `message:N` signals before admitting each session: a pause stops after the current session with pause reason `requested`, an edit replaces the objective or acceptance criteria for later sessions and assessments, and a message reaches exactly one later session. `goalControlSignal(task, family)` returns the next unused signal name. Goals persisted by earlier versions continue unchanged. Assessments may also return `context`, which reaches the next session inside `previous`, so later sessions can build on the previous answer and changed files. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.8 and 0.9.

## 0.8.0

### Minor Changes

- f03bcbf: Add durable queued steering through `run.steer()`, `runtime.steer()`, and the HTTP client/handler. Steering accepts user prompts or messages, persists receipts and application boundaries, and optionally deduplicates delivery by request ID. Replay preserves saved requests and completed effects; pending approval and recovery decisions remain explicit, and steering respects the original turn budget.

  Upgrade core and durable together for internal execution protocol 4. SQLite schemas 1–8 upgrade to schema 9; existing runs retain their original execution behavior, while newly submitted runs support steering. The HTTP packages require the matching durable release for steering protocol exports.

## 0.7.0

### Minor Changes

- Store durable model histories and loop-context checkpoints in an immutable, content-addressed
  message log with shared list prefixes. Model operation storage grows with unique messages
  instead of copying the entire transcript on every turn. SQLite schema 8 reads legacy embedded
  requests and lets unfinished 0.6.x runs finish without changing registration version fencing.
  Model-started events share physical history storage too; event payloads, ordering and cursors
  remain unchanged when read through the public APIs.

  Breaking snapshot change: new SQLite model operations have `historyEncoding: "linked-v1"`
  and `input.request.chatHistory` is an opaque `{ head, length }` reference, not a message array.
  Context operations likewise reference their input and prepared messages. Use
  `runtime.operationRequest(runId, key)` for a detached, fully reconstructed `CompletionRequest`.
  Existing embedded operations remain readable in both forms.

  Add `runtime.status(runId)` and `run.status()` for bounded status polling,
  `runtime.run(runId)` for an operation-free run record, and
  `runtime.snapshot(runId, { operations: false })` (also on run handles) for a record plus cursor.
  Listings read bounded summaries. Task snapshots omit operations by default; pass
  `{ operations: true }` to inspect task effects. Custom stores must implement
  `DurableTransaction.getRunSummary`; `getOperation` returns expanded histories while
  `operations` returns stored envelopes. Backups include the shared log, and older engines
  reject upgraded schema-8 databases. Client/server peer ranges accept durable 0.7.

## 0.6.0

### Minor Changes

- 27f8bc3: Allow durable goals to select an agent per submission, with an optional definition-level
  default. Capture the effective agent in the goal checkpoint and expose it to assessment code.
  Validate registration before accepting submissions through both goal and task APIs.

  Preserve legacy goal inputs and assessment journals across recovery. Missing registrations
  between sessions now require attention and can be retried after re-registering the agent.
  Extend the client and server peer ranges to accept the compatible durable 0.6 minor release.

  Authorize HTTP task submissions against each effective registered agent before creating work,
  including definition defaults and persisted goal bindings. Reject bindings changed during
  authorization. HTTP task submission requires durable 0.6 or newer and fails closed on older
  runtimes; existing run routes keep their compatibility.

## 0.5.0

### Minor Changes

- 676050a: Add durable goals that continue across bounded agent sessions with persisted handoffs,
  application-verified completion, cumulative model-turn budgets, admission token/deadline limits,
  stall detection, and explicit signal-based resumption. Preserve typed turn exhaustion and partial
  messages, and expose capped owned-agent spawning and direct child run inspection.

  SQLite journals upgrade to schema 7; older engines reject upgraded databases.
  Allow the new durable minor line in client/server peer dependencies.
  Document goal orchestration in the bundled durable skill.

## 0.4.0

### Minor Changes

- 0f2a6a6: Add opt-in conversation compaction on durable agent registrations. Summarize completed history
  while retaining recent complete turns and preserving canonical messages. Persist summary
  checkpoints, projected input, usage, and progress atomically for recovery, with bounded summary
  attempts using the model retry policy.

  SQLite schemas 1–5 upgrade to schema 6 when acquired. Use matching durable runtime and protocol
  consumers; older engines reject the upgraded database. Compaction runs between session runs and inside active tool loops; graph tasks remain excluded.

  Allow the durable 0.4 minor line in client and server peer compatibility ranges.

- 4867aef: Compact model-facing context during active tool loops and approval continuations. Preserve complete
  parallel tool exchanges, the active user request, and canonical history. Add
  `retention.recentToolTurns` (default one; zero allows summarizing the latest completed tool output).
  Normal and streaming runs include summary usage and emit compaction progress.

  Durable executions atomically checkpoint each model-call projection and its usage/events, including
  skipped decisions. Recovery reuses committed projections and tools; uncommitted summaries use the
  persisted retry budget. Existing submissions retain their original request sequence. SQLite schemas
  1–5 upgrade to schema 6; upgrade core and durable together for execution protocol version 3.

### Patch Changes

- 699c865: Fix `backupSqlite`/`restoreSqlite` on Windows: `fsync` was called on a read-only handle, which Windows rejects with `EPERM`. The handle now opens with write access on Windows (POSIX keeps the read-only handle so directory syncs still work). Also make the crash-signal assertion in the backup hardening test platform-aware, since Windows force-terminates the process instead of delivering `SIGKILL`.

## 0.3.0

### Minor Changes

- 9320061: Accept core structured user messages as durable prompts, enabling image and document inputs in runs, graph tasks, and owned agents. Validate multimodal content, preserve it across history and recovery, and compare request identities by canonical JSON. Existing string prompts remain supported. Allow the durable 0.3 release line in the client and server peer ranges.

## 0.2.1

### Patch Changes

- bf847ed: Add validated runtime agent registration and safe removal of idle registrations. Hosts can admit new immutable configurations without closing unrelated executions, and unload archived configurations while retaining their journal history. Existing agent IDs cannot be overwritten; unfinished runs and settling attempts prevent removal.

## 0.2.0

### Minor Changes

- ee52a9f: Add opt-in durable agent streaming with persisted generation deltas, unique model-attempt identities, and validated streamed response checkpoints. Preserve completed model/tool results across retries and restarts, and support reconnecting through the existing event cursor APIs. Upgrade SQLite records to schema 4 and the core execution protocol to version 2.

  Exclude observer failures from automatic model retries, commit streamed responses before local completion callbacks, and preserve primary stream errors when iterator cleanup also fails.

## 0.1.1

### Patch Changes

- a1c7b45: Add experimental SQLite-backed durable agent execution with deduplicated submissions,
  model/tool checkpoints, restart recovery, persisted approvals, and reconnectable progress
  events. Interrupted tools require reconciliation unless explicitly declared safe to repeat
  or backed by external idempotency. Add core execution boundaries and stable tool operation
  IDs while preserving direct agent execution behavior.

  External documentation should introduce the durable execution package and explain its
  single-owner scope, supported agent features, recovery policies, and progress-event API.

- a1c7b45: Fail closed on durable storage errors across agent and custom-task execution. Add readiness,
  aggregate metrics, configurable admission/payload/operation limits, and offline SQLite backup
  and restoration to new files. Durable now requires Node.js 22.16 or newer and custom stores
  must implement capacity-count and metrics methods.

  Expose registered custom-task submission, snapshots, ownership graphs, signals, effect
  reconciliation, retry, cancellation, and reconnectable events through the server and browser
  client. Map owned agent authorization to its parent session and include root task identity
  in task event envelopes. The durable package remains experimental.

- a1c7b45: Add schema-validated, versioned custom tasks with persisted checkpoints, dynamic child ownership,
  all-settled and fail-fast joins, owned Anvia agent runs, and inspectable task trees. Add durable
  named signals and timers, conservative external-effect journaling and reconciliation, fair phase
  scheduling, and checkpoint migrations. Extend the store contract and upgrade SQLite to schema 3.
  Custom-task APIs are currently in-process; the package remains experimental.
- a1c7b45: Add paginated durable run discovery, opt-in persisted session queues, bounded concurrency,
  and opt-in model retries with persisted attempt budgets and backoff deadlines. Capture queued
  session history only when execution starts and preserve conservative tool recovery policies.

  Add authorized Fetch-compatible durable HTTP routes and a browser-safe client with validated
  snapshots and cursor-based SSE reconnection. Add native SSE event IDs and producer cancellation
  callbacks to server stream helpers. Preserve node:sqlite imports in the durable package build.

  Document the scheduling and HTTP contracts. External documentation should include the new subpath exports,
  queue/retry statuses, authorization boundary, and reconnect flow.

- a1c7b45: Add persisted static task graphs with validated dependencies, parallel ready tasks, successful
  prerequisite gating, and committed dependency outputs. Expose atomic topology/state snapshots,
  explicit waiting reasons, correlated task events, graph discovery, and cancellation.

  Add graph HTTP/client methods and authorize child-run access against the owning graph session.
  Upgrade SQLite schema 1 to 2 on acquisition so older engines cannot bypass dependency scheduling.
  Document automatic readiness/recovery versus explicit approvals and reconciliation, with
  SIGKILL recovery and authorization test coverage.
