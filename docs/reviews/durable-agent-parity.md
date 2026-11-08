# `@anvia/durable` — Agent feature parity

Companion to [`durable-review.md`](./durable-review.md). This document enumerates the `Agent()`
surface, marks what durable supports, partially supports, rejects, or leaves unsafe, and proposes a
phased design for closing the gaps. **No implementation is included.**

- Package: `@anvia/durable` 0.14.0 (`packages/durable/package.json:3`)
- Core surface: `AgentOptions` in `packages/core/src/agent/types.ts:36`, `AgentRunSettings` in
  `packages/core/src/agent/run-types.ts:79`, `AgentInput` in `packages/core/src/agent/run-types.ts:48`
- Registration gate: `packages/durable/src/registration.ts:26`
- Evidence is `path:line`. The Phase 0 files (`packages/durable/src/registration.ts`,
  `packages/durable/src/runtime.ts`) were re-checked at `e751560f`. Other references were recorded at
  `b567bbf0f6a00c1a5b8804a22245b2872ea0a3f8` and may have moved.

Status meanings:

- **supported** — accepted and executed with durable checkpoints; replay is safe.
- **partial** — accepted or usable, but with a documented limitation, silent override, or narrower
  behaviour than core.
- **rejected** — registration throws before any work is accepted.
- **unsafe** — accepted with a behaviour change that can surprise the application or lose data.

## Known gaps (TLDR)

- **Control hooks** (`onToolCall` skip/terminate/approval, run-start and completion-call cancel): rejected.
- **Live vector context**: an agent with a `VectorContext` is rejected.
- **Memory compaction**: rejected, also under `memory: { mode: "recorded" }`.
- **Agent-level `retries`**: rejected; use `modelRetry`.
- **Per-run overrides**: `maxTurns`, `controls`, `lifecycle`, `guardrails` and `middlewares` cannot be set per run.
- **`maxTurns`**: frozen into the run record at submission.
- **`outputSchema`**: must be JSON (a JSON Schema), not an arbitrary validator.
- **Streaming**: opt-in per registration.

## Parity matrix — `AgentOptions`

| #   | Field             | Status        | Durable behaviour                                                                                                                                                                                                                    | Evidence                                                                                                                                                    |
| --- | ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `id`              | supported     | Registration key; duplicates rejected.                                                                                                                                                                                               | `packages/core/src/agent/types.ts:41`, `packages/durable/src/registration.ts:23`                                                                            |
| 2   | `name`            | supported     | Persisted through the registration and used in traces; no behaviour attached.                                                                                                                                                        | `packages/core/src/agent/types.ts:42`, `packages/durable/src/trace.ts:11`                                                                                   |
| 3   | `description`     | supported     | Static metadata; unused by execution.                                                                                                                                                                                                | `packages/core/src/agent/types.ts:43`                                                                                                                       |
| 4   | `model`           | supported     | Provider-neutral completion model. Streaming must be declared for `stream: true`; capability mismatch is rejected.                                                                                                                   | `packages/core/src/agent/types.ts:44`, `packages/durable/src/registration.ts:18`                                                                            |
| 5   | `instructions`    | supported     | Static instructions persisted with core's resolved options.                                                                                                                                                                          | `packages/core/src/agent/types.ts:45`, `packages/core/src/agent/resolve-options.ts:56`                                                                      |
| 6   | `context`         | **partial**   | Static `Document` entries are supported: snapshotted into the run record at submission and verified by content hash at every execution start. `VectorContext` entries are still rejected because live retrieval is not checkpointed. | `packages/core/src/agent/types.ts:46`, `packages/durable/src/registration.ts`, `packages/durable/src/documents.ts`                                          |
| 7   | `tools`           | **partial**   | Static local tools are supported, including approvals. `ProviderTool` entries need `providerTools: { mode: "stateless" }` (Phase 4); `ToolIndex` entries need `toolIndexes: { mode: "recorded" }` (Phase 5).                         | `packages/core/src/agent/types.ts:47`, `packages/durable/src/registration.ts:33`, `packages/durable/src/registration.ts:34`                                 |
| 8   | `mcpServers`      | **supported** | Admitted with `mcpServers: { mode: "pinned" }` (Phase 6): the discovered servers are fingerprinted at submission and checked at each execution start; each call is a tool operation (`manual` by default).                           | `packages/core/src/agent/types.ts:48`, `packages/durable/src/registration.ts`, `packages/durable/src/mcp-servers.ts`                                        |
| 9   | `skills`          | supported     | Skills are flattened into static instructions and static tools at construction, so they replay deterministically. Documented in the durable guide (`docs/packages/durable.md:598`).                                                  | `packages/core/src/agent/types.ts:49`, `packages/core/src/agent/resolve-options.ts:45`                                                                      |
| 10  | `temperature`     | supported     | Static model setting included in every request.                                                                                                                                                                                      | `packages/core/src/agent/types.ts:50`                                                                                                                       |
| 11  | `maxTokens`       | supported     | Static model setting.                                                                                                                                                                                                                | `packages/core/src/agent/types.ts:51`                                                                                                                       |
| 12  | `providerOptions` | supported     | Static provider options included in requests.                                                                                                                                                                                        | `packages/core/src/agent/types.ts:52`                                                                                                                       |
| 13  | `controls`        | supported     | Static completion controls; per-run `controls` are not exposed (see run settings).                                                                                                                                                   | `packages/core/src/agent/types.ts:53`                                                                                                                       |
| 14  | `retries`         | **rejected**  | Rejected at registration with a message that points to `modelRetry`. Runs execute with retries disabled, so an unrecorded attempt is never replayed. `false`, `0`, and `maxAttempts: 1` are accepted.                                | `packages/core/src/agent/types.ts:54`, `packages/durable/src/registration.ts:26`, `packages/durable/src/runtime.ts:735`, `packages/durable/src/types.ts:35` |
| 15  | `toolChoice`      | supported     | Static choice included in requests.                                                                                                                                                                                                  | `packages/core/src/agent/types.ts:55`                                                                                                                       |
| 16  | `maxTurns`        | **partial**   | Captured once at submission as `defaultMaxTurns + 1`; a per-run override is impossible and changing the value does not affect queued or existing runs.                                                                               | `packages/core/src/agent/types.ts:56`, `packages/durable/src/run-record.ts:22`                                                                              |
| 17  | `lifecycle`       | **supported** | Admitted with `lifecycle: { mode: "observe" }`: hooks run once per step, recorded before they run (Phase 2).                                                                                                                         | `packages/core/src/agent/types.ts:57`, `packages/durable/src/registration.ts:28`                                                                            |
| 18  | `outputSchema`    | **partial**   | Structured output is validated by core and buffered for streaming, but the outcome must be a strict JSON value; a `Date`, class instance, or `undefined` fails at persist time.                                                      | `packages/core/src/agent/types.ts:58`, `packages/durable/src/schema.ts:31`                                                                                  |
| 19  | `observability`   | supported     | Agent observers still run; durable adds its own run trace and metadata. Observer errors are ignored by core.                                                                                                                         | `packages/core/src/agent/types.ts:59`, `packages/durable/src/trace.ts:11`                                                                                   |
| 20  | `guardrails`      | **supported** | Admitted with `guardrails: { mode: "record" }`: each check's outcome is recorded before core applies it, so replay reuses it (Phase 3).                                                                                              | `packages/core/src/agent/types.ts:60`, `packages/durable/src/registration.ts:30`                                                                            |
| 21  | `middlewares`     | **supported** | Admitted with `middlewares: { mode: "pure" }`: replay compares the transformed request or tool input with the persisted one (Phase 3).                                                                                               | `packages/core/src/agent/types.ts:61`, `packages/durable/src/registration.ts:29`                                                                            |
| 22  | `memory`          | **supported** | Admitted with `memory: { mode: "recorded" }` (Phase 7). Memory compaction is still rejected.                                                                                                                                         | `packages/core/src/agent/types.ts:62`, `packages/durable/src/registration.ts:27`, `packages/durable/README.md:255`                                          |

## Parity matrix — `AgentRunSettings` / `AgentInput`

| #   | Setting / input                        | Status       | Durable behaviour                                                                                                                                                                                                                                                        | Evidence                                                                             |
| --- | -------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1   | `maxTurns`                             | **partial**  | Not passable per run; the agent-level value is frozen into the run record at submission.                                                                                                                                                                                 | `packages/core/src/agent/run-types.ts:85`, `packages/durable/src/run-record.ts:22`   |
| 2   | `retries`                              | **partial**  | Not passable per run; the runtime always passes `retries: false`. Agent-level `retries` is rejected at registration, so this override cannot hide a setting. See row 14 above.                                                                                           | `packages/core/src/agent/run-types.ts:86`, `packages/durable/src/runtime.ts:735`     |
| 3   | `abortSignal`                          | supported    | The runtime supplies its own signal; `run.cancel()` aborts it and persists cancellation. Application callbacks must honour it.                                                                                                                                           | `packages/core/src/agent/run-types.ts:87`, `packages/durable/src/runtime.ts:601`     |
| 4   | `lifecycle`                            | **rejected** | Same restriction as the agent-level field; there is no per-run escape hatch.                                                                                                                                                                                             | `packages/core/src/agent/run-types.ts:88`, `packages/durable/src/registration.ts:28` |
| 5   | `guardrails`                           | **rejected** | Same as the agent-level field.                                                                                                                                                                                                                                           | `packages/core/src/agent/run-types.ts:89`, `packages/durable/src/registration.ts:30` |
| 6   | `toolConcurrency`                      | **partial**  | Per run: not exposed. Per registration: `toolConcurrency` (default 1, positive integer) is passed to every run and reported by `compatibility()`. Each tool call still produces its own operation. Core runs a turn in order when it calls an approval or question tool. | `packages/core/src/agent/run-types.ts:90`                                            |
| 7   | `middlewares`                          | **rejected** | Same as the agent-level field.                                                                                                                                                                                                                                           | `packages/core/src/agent/run-types.ts:91`, `packages/durable/src/registration.ts:29` |
| 8   | `trace`                                | **partial**  | Runtime-managed: derived from the submission's `trace` options and durable identifiers; the client cannot set it per run.                                                                                                                                                | `packages/core/src/agent/run-types.ts:92`, `packages/durable/src/trace.ts:11`        |
| 9   | `controls`                             | **partial**  | Not passable per run; only the agent-level `controls` value is used.                                                                                                                                                                                                     | `packages/core/src/agent/run-types.ts:93`, `packages/core/src/agent/types.ts:53`     |
| 10  | `AgentInput.prompt`                    | supported    | The normal submission path; text or a structured user message, including media.                                                                                                                                                                                          | `packages/core/src/agent/run-types.ts:48`, `packages/durable/src/prompt.ts:13`       |
| 11  | `AgentInput.messages`                  | **partial**  | Used internally for history, graph inputs, and compaction projections; not accepted as a public submission. The HTTP/client contract sends a prompt only.                                                                                                                | `packages/core/src/agent/run-types.ts:57`, `packages/durable/src/types.ts:84`        |
| 12  | `AgentInput.continuation` + `response` | supported    | `run.respond()` persists the response, appends the suspended outcome's messages to history, increments the epoch, and resumes.                                                                                                                                           | `packages/core/src/agent/run-types.ts:64`, `packages/durable/src/runtime.ts:492`     |
| 13  | `AgentInput.session` (memory scope)    | **rejected** | Rejected unless the registration sets `memory: { mode: "recorded" }`; the run then scopes memory to the durable session id.                                                                                                                                              | `packages/core/src/agent/run-types.ts:52`, `packages/durable/src/registration.ts:27` |

## Parity matrix — features

| Feature                                                  | Status    | Notes and evidence                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static local tools                                       | supported | Persisted tool operations with a recovery policy per tool; unlisted tools default to `manual`. `packages/durable/src/registration.ts:40`, `packages/durable/src/execution.ts:250`                                                                                                                               |
| Tool approvals and questions                             | supported | Core returns an `interaction` outcome; durable persists it and resumes on `respond`. `packages/durable/src/runtime.ts:492`, `packages/durable/src/runtime.ts:479`                                                                                                                                               |
| Tool result reconciliation                               | supported | `needs_attention` + `blockedOperation` + `resolveTool`, verified in this review. `packages/durable/src/runtime.ts:537`                                                                                                                                                                                          |
| Streaming model output                                   | partial   | Opt-in per registration, model must be streaming-capable, deltas are persisted as `model_delta` events and checked against the payload limit. No per-run override and no UI protocol. `packages/durable/src/registration.ts:18`, `packages/durable/src/execution.ts:195`                                        |
| Steering                                                 | supported | Persisted at turn boundaries with empty checkpoints; `run.steer()` and `DurableClient.steer()`. `packages/durable/src/runtime.ts:479`, `packages/client/src/durable.ts:281`                                                                                                                                     |
| Structured output                                        | partial   | Validated by core and buffered; only JSON-serializable outputs persist. `packages/durable/src/schema.ts:31`                                                                                                                                                                                                     |
| Model retry                                              | supported | Opt-in registration policy, error-class limited (model/compactor only), attempt counters persisted. `packages/durable/src/registration.ts:87`, `packages/durable/src/schema.ts:81`                                                                                                                              |
| Compaction                                               | partial   | Registration-only; protects the model window and rewrites the model-facing projection, but canonical history is preserved and still counts against the payload limit. No manual trigger. `packages/durable/src/types.ts:21`, `packages/durable/src/compaction.ts:56`, `packages/durable/src/loop-context.ts:32` |
| Tracing / observability                                  | supported | Agent observers keep working; durable adds a stable trace id and metadata, with a 16 KiB cap on submitted trace options. `packages/durable/src/trace.ts:11`, `packages/durable/src/trace-schema.ts:7`                                                                                                           |
| Graph DAG (agents as nodes)                              | supported | Additive surface; not part of `Agent()` but part of durable's orchestration. `docs/packages/durable.md:257`                                                                                                                                                                                                     |
| Tasks, goals, owned subagents                            | supported | Additive surface (`defineTask`, `defineGoal`, `ctx.spawnAgent`), with their own checkpoint boundaries. `packages/durable/src/index.ts:2`, `docs/packages/durable.md:559`                                                                                                                                        |
| Pipeline / team recovery                                 | rejected  | Explicitly out of scope in the docs. `docs/packages/durable.md:567`                                                                                                                                                                                                                                             |
| MCP servers                                              | supported | Admitted with `mcpServers: { mode: "pinned" }` (Phase 6): discovery stays in the application; the server fingerprint is checked per run and each call is a tool operation. `packages/durable/src/mcp-servers.ts`, `packages/durable/src/runtime.ts`                                                             |
| Provider tools                                           | supported | Admitted with `providerTools: { mode: "stateless" }` (Phase 4): part of the persisted model request, so a changed definition fails replay. `packages/durable/src/registration.ts:33`                                                                                                                            |
| Dynamic tool indexes                                     | supported | Admitted with `toolIndexes: { mode: "recorded" }` (Phase 5): each model call's selection is recorded before the call and reused on replay; the index fingerprint is checked at each execution start. `packages/durable/src/tool-indexes.ts`, `packages/durable/src/execution.ts`                                |
| Memory store / save policies                             | supported | Admitted with `memory: { mode: "recorded" }` (Phase 7): read snapshot before the first model call, writes after the terminal checkpoint as keyed `memory` operations. `packages/durable/src/recorded-memory.ts`                                                                                                 |
| Lifecycle callbacks                                      | supported | Admitted with `lifecycle: { mode: "observe" }` (Phase 2): hooks run at most once per step, recorded before they run.                                                                                                                                                                                            |
| Control hooks (`onToolCall`, run start, completion call) | supported | Admitted with `hooks: { mode: "record", hook }`: each skip / terminate / approval / cancel decision is recorded before it is applied and reused on replay; an unrecorded start fails to `needs_attention`. Core runs tools one at a time while a hook is active.                                                |
| Guardrails                                               | supported | Admitted with `guardrails: { mode: "record" }` (Phase 3): outcomes recorded before use, replay reuses them. `packages/durable/src/registration.ts:30`                                                                                                                                                           |
| Middleware                                               | supported | Admitted with `middlewares: { mode: "pure" }` (Phase 3): replay compares transformed requests and tool inputs. `packages/durable/src/registration.ts:29`                                                                                                                                                        |
| Static `Document` context                                | supported | Snapshotted into the run record at submission (`contextDocuments` hash + documents); replay verifies the registration still resolves the same hash and fails with a recovery error otherwise. `packages/durable/src/documents.ts`, `packages/durable/src/run-record.ts`                                         |

## Why the rejected set is rejected

The registration comment states the design rule: these callbacks "can perform effects or change
requests during reconstruction. Add them only with their own persistence boundaries, never silently
replay them" (`packages/durable/src/registration.ts:24`). That is the correct default for a
journal-based runtime. The gaps are:

1. **No boundary for external reads.** `VectorContext` retrieval, MCP discovery, tool indexes, and
   memory reads all fetch data that can change between attempts.
2. **No boundary for external writes or request mutation.** lifecycle hooks, middleware, guardrails,
   and memory saves can perform effects or rewrite the request.
3. **No invocation log.** There is no record of "this hook already ran for this step", so replay
   cannot skip it.
4. **One coarse gate.** A pure logging middleware is rejected together with an effectful one.
   (Phase 1 split static `Document` context out of this gate; live vector search stays rejected.)

## Phased design

Each phase is independently shippable and testable. The rule for every phase: **persist the input
and the decision before the side effect, and make replay reuse the persisted value**. A feature is
only admitted when its checkpoint boundary is defined.

### Phase 0 — Make the current contract honest (no new features) — done

Shipped in `@anvia/durable` 0.13.0:

- Agent-level `retries` is rejected at registration with a message that points to `modelRetry`.
  Runs still execute with retries disabled, so an unrecorded attempt is never replayed.
- The feature error names only the features the agent sets (`memory`, `lifecycle`, `middleware`,
  `guardrails`, `context`, `MCP servers`, provider tools, tool indexes).
- `runtime.compatibility()` returns the report, and the `onCompatibility` option receives it after
  `open()` and each `registerAgents()`. The runtime does not log by itself; the host decides what to
  log.
- `skills` is documented as supported, and the per-run settings that are not exposed are listed in
  `docs/packages/durable.md` ("Agent feature compatibility").
- **Checkpoint boundary:** none; registration only.
- **Tests:** `packages/durable/test/agent-parity.test.ts` covers the `retries` rejection, the
  accepted no-retry forms, the named feature errors, the report, and the `onCompatibility` hook.
- **Effort/risk:** S / low. Prevents the DUR-21 surprise before adding anything.

### Phase 1 — Static `Document` context — done

Shipped in `@anvia/durable` 0.14.0:

- `AgentContextInput` entries that are `Document`s are admitted; `VectorContext` entries stay
  rejected with the same `context` feature error.
- Each run record snapshots the registration's resolved documents at submission as
  `run.contextDocuments`: a content hash plus the document set (stored through the blob table when
  the set exceeds the inline threshold, so a large document cannot fail admission).
- At every execution start the registration's current documents are re-hashed and compared with the
  snapshot. A mismatch under the same `registration.version` throws a `DurableRecoveryError`
  (status `needs_attention`) naming both hashes; restoring the original documents and calling
  `retry()` resumes the run. Document changes ship with a version bump, as before.
- **Checkpoint boundary:** the submission transaction that writes the run record (before the first
  model call), plus the verification gate at every execution start.
- **Tests:** `packages/durable/test/static-context.test.ts` covers the document reaching the model
  request, restart plus retry replaying identical documents, a changed document failing with both
  hashes, and a large document set stored as a blob reference; `agent-parity.test.ts` keeps the
  `VectorContext` rejection covered.
- **Effort/risk:** M / medium, as estimated.

### Phase 2 — Observational lifecycle

**Design decisions (session 2).** The plan left these open; they are settled here.

- **Marker:** `registration.lifecycle: { mode: "observe" }`. The agent keeps its normal
  `lifecycle` hooks; the marker is the registration's declaration that they are observational. An
  agent with `lifecycle` and no marker is still rejected, with the same message.
- **Mechanism:** core gains one internal run option, `lifecycle`. When durable passes it, it
  replaces the agent's composed lifecycle for that run, so each hook fires once through durable's
  gate and never twice (agent hooks plus a per-run wrapper). Public core API is unchanged.
- **Record:** an operation of kind `effect`, key `${epoch}:lifecycle:${hook}:${step}:${toolCallId}`
  (`start` uses step 0; `finish` and `error` use the run's `modelTurns`, so a second failure after a
  retry gets a new key). It is written as `started` before the hook runs and becomes `completed` with
  `{ failed, error? }` after it. Replay skips any hook whose record exists, including a `started`
  one, so a crash during a hook is at-most-once and is never re-run.
- **Failures:** a throwing hook is recorded in its record and never changes the run outcome.
- **Inputs:** each event is a structured-clone snapshot, deep-frozen before the hook sees it.
- **Not covered:** `toolCallId` is optional in core; a tool event without one shares a key with
  other such events of the same step. Hook output is not persisted.

- Admit only hooks that are declared observational (`onStart`, `onStepFinish`, `onToolStart`,
  `onToolFinish`, `onFinish`, `onError`), with an explicit `lifecycle: { mode: "observe" }` marker.
- Persist an invocation record keyed by `runId:epoch:step:kind:toolCallId` before invoking the hook;
  on replay, skip records that already exist. Record failures without changing the run outcome.
- Document at-least-once semantics: a crash between the record and the hook can lose an invocation;
  a crash after the hook but before completion can repeat it if the record was not committed first.
  To avoid that, commit the invocation record before the hook and never re-run it.
- **Checkpoint boundary:** after each committed model/tool/context step, before the next step.
- **Tests:** a hook runs once per step across a restart; a hook throwing does not fail the run; a
  hook that mutates its event object cannot change the persisted request (deep-frozen input).
- **Effort/risk:** M-L / medium. The type system currently returns `void`, but JavaScript can still
  mutate objects, so freeze inputs.

### Phase 3 — Guardrails and middleware

**Design decisions (session 3).** The plan left the request-equivalence contract and
the effect classification open. Settled here:

- **Middleware marker: `middlewares: { mode: "pure" }`.** Admits `middlewares` on the agent. The
  application declares that its `onCompletionRequest`, `onCompletionResponse`, `onToolInput` and
  `onToolOutput` hooks are deterministic and free of external effects. Without the marker,
  `middlewares` is rejected with a message naming the field and the marker. JavaScript cannot
  enforce purity; the marker is a contract the application makes.
- **Request equivalence:** core computes the transformed request before it calls the execution
  gate, and durable persists that request as the model operation input (`start()` already compares
  it). The gate cannot skip a middleware, so on replay a pure middleware runs again and its result
  is compared with the persisted request. A different transformation under the same key is the
  existing "Execution changed at a saved checkpoint" recovery error. Skipping the middleware on
  replay would need a core change to the execution contract, which is deferred. Tool output
  middleware runs inside the tool's execution, so its result is persisted and not re-run.
- **Guardrail marker: `guardrails: { mode: "record" }`.** Admits `guardrails`. Checks may be
  effectful, so each check's outcome is recorded before core uses it, as an `effect` operation keyed
  `${epoch}:guardrail:${boundary}:${slot}:${policyId}:${guardrailId}`. `slot` is `input` for the
  input boundary and `${modelTurns}:${retries}` for output. Replay returns the recorded outcome
  (an action, or the thrown message) without calling the check. Core gains an internal run option
  that replaces the agent's policies for the run with these wrapped policies.
- **Errors are retryable, decisions are not.** A check that threw is recorded as an error with the
  run's retry count. After `retry()`, that check runs again and its new outcome is recorded under
  `:attemptN`; the earlier error stays in the journal. Allow, block and rewrite decisions are reused
  as they were, so they stay terminal. Registration rejects two checks with the same id in one
  policy, because they would share a key.
- **Decisions are terminal.** A blocking input decision completes the run with a `blocked` outcome,
  which is persisted, so a restart returns it and never calls the model. A check that was started
  but never recorded (a crash inside it) is not re-run: an enforced policy fails the run with a
  recovery error that names the key (`needs_attention`). An observe-mode policy records an error
  decision instead, since observe mode never changes the outcome.
- **Checkpoint boundary:** each guardrail outcome is committed before core applies it. Middleware
  has no boundary of its own; its output is covered by the model/tool operation it feeds.
- **Not covered:** a middleware or guardrail that is not actually pure is not detected on replay
  unless it changes a persisted request or tool input. A recorded guardrail decision is reused
  even if its code later changes, until the registration version is bumped.

- Persist the **transformed request** as the model operation input, exactly as `start()` already
  compares inputs (`packages/durable/src/execution.ts:111`). On replay, run the transformation only
  if no operation exists; otherwise reuse the persisted request.
- Persist guardrail decisions as operation results/events; a blocking decision becomes the run's
  terminal outcome, not a retry.
- Restrict middleware to pure functions for the first release, or require a `durable: "pure"` marker;
  reject anything that declares external effects. Alternatively model a middleware's external call as
  a durable `effect` operation with an idempotency key.
- **Checkpoint boundary:** input transformation committed atomically with the model/tool operation
  start; decisions committed before the side effect.
- **Tests:** replay does not re-run a middleware; a guardrail block is terminal and survives restart;
  a changed transformation under the same operation key is a recovery error.
- **Effort/risk:** L / high. This is the phase where request equivalence and effect classification
  need a clear contract.

### Phase 4 — Provider tools

**Design decisions (session 3).** The plan left the marker open. Settled here:

- **Marker: `providerTools: { mode: "stateless" }`.** The provider must keep no state between
  calls; a stateful hosted tool cannot be replayed from the journal (features list item 5).
  Without the marker, provider tools are rejected, and the error names the marker.
- **Pinned definition:** provider tool definitions are sent in `request.providerTools`, which is
  part of the model operation input. `start()` already compares that input, so a changed definition
  under the same operation key is the "Execution changed at a saved checkpoint" recovery error.
  No new persistence was added.
- **Responses:** the provider's own tool calls (`providerToolCalls`) are part of the normalized
  response that is saved with the model operation, so replay reuses them and does not ask again.
- **Checkpoint boundary:** the model operation itself (no separate operation), as the plan says.
- **Not covered:** adapter mapping of provider tool calls is in the provider packages, which mock
  the SDK; durable tests use a stub model that returns normalized `providerToolCalls`.

- Admit `ProviderTool` definitions. They are part of the model request, and responses already persist
  the full normalized response; provider tool calls are already mapped in streams
  (`packages/core/src/internal/agent-runtime/execution.ts:16`).
- Pin provider and tool definitions in the model operation input; a changed definition fails the
  request comparison.
- **Checkpoint boundary:** the model operation itself; no separate tool operation.
- **Tests:** replay reuses the persisted response; a changed provider tool definition is rejected;
  provider tool calls render through the adapter mapping.
- **Effort/risk:** M / medium (mostly validation and versioning).

### Phase 5 — Dynamic tool indexes

**Status (session 6): implemented.** Decisions:

- **Marker: `toolIndexes: { mode: "recorded" }`.** Without it, `ToolIndex` entries are rejected with
  a message that names the marker.
- **Core hook (internal only):** `AgentRunExecution.selectTools(turn, select)` wraps the call to
  `fetchToolDefinitions` in `createTurnRequest`. Public API is unchanged, so this is a core patch.
- **Record:** effect operation `${epoch}:tools:${turn}`, result `{ tools }` with the full definitions
  of the static tools and the index results, in JSON form. It is written before the model
  operation. A replayed turn returns the record and does not call `select`, so the search does not
  run again.
- **Fingerprint:** `toolIndexesOf` hashes each index's `topK`, `minScore`, `filter` and each tool's
  `definition("")`. The embedded documents are not readable from a `ToolIndex`, so the embedding
  model is not covered: a model change still needs a version bump. The hash is stored in the run
  record at submission (computed before the transaction, since definitions are async) and checked
  at every execution start; a mismatch under the same version is a `needs_attention` recovery error.
- **Not covered:** the index search itself is not re-validated against the store, and a recorded
  selection is reused even if the code that builds it later changes, until the version is bumped.
- **Tests:** `packages/durable/test/tool-indexes.test.ts` (selection reused across restart with a
  search count, index change is a recovery error, selection visible in the model operation input,
  rejection names the marker, matrix entries). `packages/core/test/agent-execution.test.ts` covers
  the hook.

- Resolve the index once per model call, persist the selected tool names and full definitions in the
  model operation input, and use the persisted selection on replay.
- Bump `registration.version` when the index contents or embedding model change; store an index
  content hash.
- **Checkpoint boundary:** before the model operation, atomic with its input (same transaction as
  `start()`), so a crash cannot select a different set on retry.
- **Tests:** two executions of the same operation use one selection; an index change with the same
  version is a recovery error; selected tools are visible in the operation input.
- **Effort/risk:** M / medium. The main risk is silent quality drift, not correctness.

### Phase 6 — MCP servers

**Status (session 6): implemented without a core change.**

**Design decisions (session 6).** The plan assumed discovery runs inside the run in
core, which would need a core hook. Reading the code shows it does not:

- **Discovery happens in the application, before the agent is built.** `McpClient.connect()`
  (`packages/mcp/src/client.ts`) lists the server's tools and returns an `McpServer` snapshot. Core
  freezes that snapshot into the agent (`packages/core/src/agent/tool-catalog.ts`). Each tool's
  `definition()` returns the schema copied at connect, so the definitions are static for the life
  of the agent. Durable therefore needs no core change.
- **MCP tools are static tools.** Core puts them in the same tool list as local tools, so each call is
  already a tool operation, and the registration's `toolRecovery` (default `manual`) applies. An
  interrupted call blocks for reconciliation through the existing path.
- **Marker: `mcpServers: { mode: "pinned" }`.** Without it, `mcpServers` is rejected and the error
  names the marker. With it, the run record stores a fingerprint of the servers at submission: each
  server's name, `serverInfo`, `capabilities`, `instructions`, and each tool's exposed name, remote
  name, server name and definition. The fingerprint is checked at every execution start. A different
  tool list under the same version fails the run with `needs_attention`, before any model call.
- **Restart:** durable does not call `listTools` itself. A restart reuses the completed calls and
  the persisted model requests, and a changed server fails the run instead of silently changing the
  tools.
- **Not covered:** a changed `requiresApproval` predicate or call implementation is not detected
  (functions cannot be fingerprinted). Transport and auth failures are tool failures and follow the
  existing retry taxonomy; they are not tested offline. The remote server's behaviour is outside
  the journal: an uncertain `manual` call blocks, and `resolveTool` reconciles it.
- **Checkpoint boundary:** the fingerprint is committed with the submission. Each call is a tool
  operation as before.
- **Tests:** `packages/durable/test/mcp-servers.test.ts`: marker rejection, restart with an
  identical server reuses completed calls, a changed server tool list is a recovery error under the
  same version, and an uncertain call blocks for reconciliation.

- Treat MCP tool discovery like a persisted registration artifact: discover once, persist the tool
  list and schemas, and require a version/hash. Execute each call as an ordinary tool operation with
  recovery policy `manual` by default.
- Handle auth and transport failures as model/tool failures with the existing retry taxonomy; never
  re-run a call whose intent was committed unless the policy says `safe`/`idempotent`.
- **Checkpoint boundary:** discovery before the first model call; each call as a tool operation.
- **Tests:** restart reuses discovery; a changed server tool list fails under the same version; an
  uncertain call blocks for reconciliation.
- **Effort/risk:** L / high. This is the largest external surface and should come last.

### Phase 7 — Memory store

**Status: admitted with `memory: { mode: "recorded" }` (parity phase 7, part C2).** Without the marker,
memory is still rejected, and the error names the `memory` field and the marker. The store contract is
the versioned one in `@anvia/core` (`loadVersioned()`, and `append()` with `idempotencyKey` and
`expectedVersion`, PR #643). Durable admits it as follows:

- The read snapshot (`loadVersioned()`) is recorded as a `memory` operation before the first model
  call, and a replay reuses it.
- Core's appends are captured during the run. They are written only after the terminal checkpoint, in
  order, each as a `memory` operation with recovery `manual`. A crash between the checkpoint and the
  writes keeps the run `running` until they finish.
- The idempotency key is derived by the runtime as `${runId}/${epoch}:memory:write:${seq}`; callers
  cannot set it. Each write's `expectedVersion` is the version the previous step left behind, so a
  concurrent writer makes the run `needs_attention` with a conflict, and nothing is written.
- An interrupted write is uncertain. The run needs attention, and `retry()` sends it again under the
  same key.
- Rejected under the marker: `memory.compaction`, and a store without `loadVersioned()`.
- A run that pauses for a human interaction is supported. The paused segment's writes are flushed
  before the run waits; core does not read memory on resume, so nothing is offered twice. The
  resumed segment's writes use keys under the next epoch and are based on the version the previous
  segment left behind, so a writer that commits during the pause makes the resume `needs_attention`.
- Adapters: `memory-sqlite`, `memory-postgres`, `memory-prisma` and `memory-drizzle` implement the
  versioned contract, each with an idempotency-key table that survives `clear()`.
- Operator path: `run.resolveMemoryWrite(operationKey, "applied" | "discarded")` settles a blocked
  write. `retry()` only sends the same write again, so it cannot clear a conflict.
- Rejected at admission: a recorded memory agent in a graph task or an owned agent task
  (`spawnAgent`, including `continueFrom`). Both run under a synthetic session, so the agent would
  read an empty history and write into a scope nobody names.

Findings that shaped the contract (`packages/core/src/memory/types.ts` before #643):

- `append` had no idempotency key and returned nothing, so a caller could not tell a committed write
  from an unsent one, or a duplicate from a new write.
- `load` had no version, so a read snapshot could not be checked later for changes.
- The save policy (`message`, `turn`, `run`) decides when `append` runs, outside any durable
  checkpoint; durable captures the appends and writes them after the terminal checkpoint instead.

- **Checkpoint boundary:** the read before the first model call; each write as a `memory` operation
  after the terminal checkpoint.
- **Tests:** `packages/durable/test/recorded-memory.test.ts` (replay, duplicate writes, conflicts,
  resolution, streaming, graph and task rejection, the write-after-checkpoint order, crash resume,
  and a SIGKILL of a real worker process); `recorded-memory-sqlite.test.ts` runs it against the
  SQLite adapter and `packages/durable/test/agent-parity.test.ts`
  (rejection without the marker).
- **Decisions:** graph tasks and owned agent tasks stay rejected. Each would need a stable memory
  scope of its own, a task child that continues another (`continueFrom`) would need that scope
  carried across runs, and parallel nodes sharing one scope would conflict on every write. A
  recorded memory agent is submitted directly, where the session id names the scope. Memory
  compaction and the registration's `compaction` stay rejected for the reasons in the README.
- **HTTP:** `POST /durable/runs/:id/resolve-memory-write`, `DurableClient.resolveMemoryWrite()` and the
  chat controller method settle a blocked write.

## Checkpoint boundaries

| Feature                 | Persist before                      | Persisted value                      | Replay rule                                | Failure policy                   |
| ----------------------- | ----------------------------------- | ------------------------------------ | ------------------------------------------ | -------------------------------- |
| Static context          | First model call                    | Resolved documents + hash            | Reuse text; hash mismatch = recovery error | `needs_attention`                |
| Observational lifecycle | Before each hook invocation         | Invocation record                    | Skip recorded invocations                  | Log, never fail the run          |
| Middleware / guardrails | With the model/tool operation start | Transformed request + decisions      | Reuse request; decisions are terminal      | Recovery error on changed input  |
| Provider tools          | With the model operation            | Provider/tool definitions            | Reuse the model response                   | Same as model                    |
| Tool index              | With the model operation            | Selected tool names + definitions    | Reuse selection                            | Recovery error on changed hash   |
| MCP discovery           | Before first model call             | Tool list + schemas + hash           | Reuse discovery                            | Recovery error on changed server |
| MCP calls               | Before the call                     | Tool operation (input, policy)       | Reuse completed; `manual` blocks           | Reconciliation                   |
| Memory read             | Before first model call             | Snapshot                             | Reuse snapshot                             | `needs_attention`                |
| Memory write            | Before the write                    | `memory` operation + idempotency key | Reuse completed                            | Reconciliation                   |

## Features that should stay unsupported

These are not scheduling gaps; admitting them without a new persistence primitive would break the
journal's replay guarantees.

1. **Live `VectorContext` retrieval.** The result depends on an external index and can change between
   attempts. Admit only if the retrieved documents are persisted with the run (a Phase 1 extension),
   and even then the retrieval query must be part of the request.
2. **Arbitrary effectful lifecycle hooks or middleware.** A callback that sends an email, charges a
   card, or mutates the request cannot be replayed safely. Keep them rejected unless they are marked
   pure/observational or are modelled as durable effects.
3. **Guardrails that call external moderation services.** These are external effects with latency
   and non-determinism. Keep them out until an effect-operation boundary and an idempotency contract
   exist.
4. **Memory stores without versions or idempotent writes.** Without them, replay duplicates writes
   and a concurrent writer goes unnoticed. Keep rejected: recorded memory requires `loadVersioned()`.
5. **Provider-hosted tools that keep server-side state.** The journal can persist the request and
   response but cannot replay the provider's internal state. Admit only stateless provider tools.
6. **Pipeline/team recovery, Studio integration, Postgres, retention, distributed owners.** These are
   explicitly listed as follow-up work (`docs/packages/durable.md:567`) and are not Agent parity
   items.

## Recommended order and rationale

1. **Phase 0** — removes the silent-override hazard and gives applications a truthful compatibility
   report. Lowest risk, highest trust payoff.
2. **Phase 1** — static documents cover the most common `AgentOptions.context` use case without
   touching external retrieval.
3. **Phase 2** — observational hooks are low-risk and unblock logging/metrics integrations.
4. **Phase 3** — guardrails and middleware are the largest semantic change; do them after the
   request-equivalence contract is exercised by Phases 1–2.
5. **Phases 4–5** — provider tools and tool indexes are mostly validation and persistence of
   definitions; they can ship together.
6. **Phase 6** — MCP is the largest external surface; defer until the tool-operation recovery story
   is proven in production.
7. **Phase 7** — memory came last, after a versioned, idempotent store contract existed in core.

Each phase should ship behind a registration flag while the docs name its marker, and each
should add its own changeset: `@anvia/durable` **minor** for new accepted features (pre-1.0), with
`@anvia/core` unchanged unless the resolved-options contract needs a new field.

## Test strategy for parity work

- Add a registration matrix test that instantiates one agent per `AgentOptions` field and asserts the
  exact status (accepted, rejected, or accepted with a warning). This prevents silent regressions and
  doubles as documentation.
- For every accepted feature, add a restart test: run to a checkpoint, close the runtime, reopen,
  `resume()`, and assert the persisted value was reused and the external source was not re-read.
- For every rejected feature, assert the error names the field and the required persistence boundary.
- Reuse the existing helpers (`makeAgent`, `SqliteDurableStore`, `response`) and the
  `limits: { maxPayloadBytes: ... }` pattern for size-sensitive tests.
- Keep the durable suite green; no parity change should require weakening a recovery test.
