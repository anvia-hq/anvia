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

## Parity matrix — `AgentOptions`

| #   | Field             | Status       | Durable behaviour                                                                                                                                                                                                                    | Evidence                                                                                                                                                    |
| --- | ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `id`              | supported    | Registration key; duplicates rejected.                                                                                                                                                                                               | `packages/core/src/agent/types.ts:41`, `packages/durable/src/registration.ts:23`                                                                            |
| 2   | `name`            | supported    | Persisted through the registration and used in traces; no behaviour attached.                                                                                                                                                        | `packages/core/src/agent/types.ts:42`, `packages/durable/src/trace.ts:11`                                                                                   |
| 3   | `description`     | supported    | Static metadata; unused by execution.                                                                                                                                                                                                | `packages/core/src/agent/types.ts:43`                                                                                                                       |
| 4   | `model`           | supported    | Provider-neutral completion model. Streaming must be declared for `stream: true`; capability mismatch is rejected.                                                                                                                   | `packages/core/src/agent/types.ts:44`, `packages/durable/src/registration.ts:18`                                                                            |
| 5   | `instructions`    | supported    | Static instructions persisted with core's resolved options.                                                                                                                                                                          | `packages/core/src/agent/types.ts:45`, `packages/core/src/agent/resolve-options.ts:56`                                                                      |
| 6   | `context`         | **partial**  | Static `Document` entries are supported: snapshotted into the run record at submission and verified by content hash at every execution start. `VectorContext` entries are still rejected because live retrieval is not checkpointed. | `packages/core/src/agent/types.ts:46`, `packages/durable/src/registration.ts`, `packages/durable/src/documents.ts`                                          |
| 7   | `tools`           | **partial**  | Static local tools are supported, including approvals. `ProviderTool` and `ToolIndex` entries are rejected.                                                                                                                          | `packages/core/src/agent/types.ts:47`, `packages/durable/src/registration.ts:33`, `packages/durable/src/registration.ts:34`                                 |
| 8   | `mcpServers`      | **rejected** | MCP discovery and tool execution are not checkpointed.                                                                                                                                                                               | `packages/core/src/agent/types.ts:48`, `packages/durable/src/registration.ts:32`                                                                            |
| 9   | `skills`          | supported    | Skills are flattened into static instructions and static tools at construction, so they replay deterministically. Documented in the durable guide (`docs/packages/durable.md:598`).                                                  | `packages/core/src/agent/types.ts:49`, `packages/core/src/agent/resolve-options.ts:45`                                                                      |
| 10  | `temperature`     | supported    | Static model setting included in every request.                                                                                                                                                                                      | `packages/core/src/agent/types.ts:50`                                                                                                                       |
| 11  | `maxTokens`       | supported    | Static model setting.                                                                                                                                                                                                                | `packages/core/src/agent/types.ts:51`                                                                                                                       |
| 12  | `providerOptions` | supported    | Static provider options included in requests.                                                                                                                                                                                        | `packages/core/src/agent/types.ts:52`                                                                                                                       |
| 13  | `controls`        | supported    | Static completion controls; per-run `controls` are not exposed (see run settings).                                                                                                                                                   | `packages/core/src/agent/types.ts:53`                                                                                                                       |
| 14  | `retries`         | **rejected** | Rejected at registration with a message that points to `modelRetry`. Runs execute with retries disabled, so an unrecorded attempt is never replayed. `false`, `0`, and `maxAttempts: 1` are accepted.                                | `packages/core/src/agent/types.ts:54`, `packages/durable/src/registration.ts:26`, `packages/durable/src/runtime.ts:735`, `packages/durable/src/types.ts:35` |
| 15  | `toolChoice`      | supported    | Static choice included in requests.                                                                                                                                                                                                  | `packages/core/src/agent/types.ts:55`                                                                                                                       |
| 16  | `maxTurns`        | **partial**  | Captured once at submission as `defaultMaxTurns + 1`; a per-run override is impossible and changing the value does not affect queued or existing runs.                                                                               | `packages/core/src/agent/types.ts:56`, `packages/durable/src/run-record.ts:22`                                                                              |
| 17  | `lifecycle`       | **rejected** | Hooks can perform effects or change requests; no invocation checkpoint exists.                                                                                                                                                       | `packages/core/src/agent/types.ts:57`, `packages/durable/src/registration.ts:28`                                                                            |
| 18  | `outputSchema`    | **partial**  | Structured output is validated by core and buffered for streaming, but the outcome must be a strict JSON value; a `Date`, class instance, or `undefined` fails at persist time.                                                      | `packages/core/src/agent/types.ts:58`, `packages/durable/src/schema.ts:31`                                                                                  |
| 19  | `observability`   | supported    | Agent observers still run; durable adds its own run trace and metadata. Observer errors are ignored by core.                                                                                                                         | `packages/core/src/agent/types.ts:59`, `packages/durable/src/trace.ts:11`                                                                                   |
| 20  | `guardrails`      | **rejected** | Guardrail policies can block or modify input/output and are not checkpointed.                                                                                                                                                        | `packages/core/src/agent/types.ts:60`, `packages/durable/src/registration.ts:30`                                                                            |
| 21  | `middlewares`     | **rejected** | Middleware wraps model and tool calls and may mutate requests or perform effects.                                                                                                                                                    | `packages/core/src/agent/types.ts:61`, `packages/durable/src/registration.ts:29`                                                                            |
| 22  | `memory`          | **rejected** | Memory store reads/writes and memory compaction are not durable operations; the durable guide directs users to registration compaction instead.                                                                                      | `packages/core/src/agent/types.ts:62`, `packages/durable/src/registration.ts:27`, `packages/durable/README.md:255`                                          |

## Parity matrix — `AgentRunSettings` / `AgentInput`

| #   | Setting / input                        | Status       | Durable behaviour                                                                                                                                                              | Evidence                                                                             |
| --- | -------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1   | `maxTurns`                             | **partial**  | Not passable per run; the agent-level value is frozen into the run record at submission.                                                                                       | `packages/core/src/agent/run-types.ts:85`, `packages/durable/src/run-record.ts:22`   |
| 2   | `retries`                              | **partial**  | Not passable per run; the runtime always passes `retries: false`. Agent-level `retries` is rejected at registration, so this override cannot hide a setting. See row 14 above. | `packages/core/src/agent/run-types.ts:86`, `packages/durable/src/runtime.ts:735`     |
| 3   | `abortSignal`                          | supported    | The runtime supplies its own signal; `run.cancel()` aborts it and persists cancellation. Application callbacks must honour it.                                                 | `packages/core/src/agent/run-types.ts:87`, `packages/durable/src/runtime.ts:601`     |
| 4   | `lifecycle`                            | **rejected** | Same restriction as the agent-level field; there is no per-run escape hatch.                                                                                                   | `packages/core/src/agent/run-types.ts:88`, `packages/durable/src/registration.ts:28` |
| 5   | `guardrails`                           | **rejected** | Same as the agent-level field.                                                                                                                                                 | `packages/core/src/agent/run-types.ts:89`, `packages/durable/src/registration.ts:30` |
| 6   | `toolConcurrency`                      | **partial**  | Not exposed; core's default is used and concurrent tool calls still produce one operation each.                                                                                | `packages/core/src/agent/run-types.ts:90`                                            |
| 7   | `middlewares`                          | **rejected** | Same as the agent-level field.                                                                                                                                                 | `packages/core/src/agent/run-types.ts:91`, `packages/durable/src/registration.ts:29` |
| 8   | `trace`                                | **partial**  | Runtime-managed: derived from the submission's `trace` options and durable identifiers; the client cannot set it per run.                                                      | `packages/core/src/agent/run-types.ts:92`, `packages/durable/src/trace.ts:11`        |
| 9   | `controls`                             | **partial**  | Not passable per run; only the agent-level `controls` value is used.                                                                                                           | `packages/core/src/agent/run-types.ts:93`, `packages/core/src/agent/types.ts:53`     |
| 10  | `AgentInput.prompt`                    | supported    | The normal submission path; text or a structured user message, including media.                                                                                                | `packages/core/src/agent/run-types.ts:48`, `packages/durable/src/prompt.ts:13`       |
| 11  | `AgentInput.messages`                  | **partial**  | Used internally for history, graph inputs, and compaction projections; not accepted as a public submission. The HTTP/client contract sends a prompt only.                      | `packages/core/src/agent/run-types.ts:57`, `packages/durable/src/types.ts:84`        |
| 12  | `AgentInput.continuation` + `response` | supported    | `run.respond()` persists the response, appends the suspended outcome's messages to history, increments the epoch, and resumes.                                                 | `packages/core/src/agent/run-types.ts:64`, `packages/durable/src/runtime.ts:492`     |
| 13  | `AgentInput.session` (memory scope)    | **rejected** | Rejected with `Agent.memory`; durable sessions are its replacement.                                                                                                            | `packages/core/src/agent/run-types.ts:52`, `packages/durable/src/registration.ts:27` |

## Parity matrix — features

| Feature                       | Status    | Notes and evidence                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static local tools            | supported | Persisted tool operations with a recovery policy per tool; unlisted tools default to `manual`. `packages/durable/src/registration.ts:40`, `packages/durable/src/execution.ts:250`                                                                                                                               |
| Tool approvals and questions  | supported | Core returns an `interaction` outcome; durable persists it and resumes on `respond`. `packages/durable/src/runtime.ts:492`, `packages/durable/src/runtime.ts:479`                                                                                                                                               |
| Tool result reconciliation    | supported | `needs_attention` + `blockedOperation` + `resolveTool`, verified in this review. `packages/durable/src/runtime.ts:537`                                                                                                                                                                                          |
| Streaming model output        | partial   | Opt-in per registration, model must be streaming-capable, deltas are persisted as `model_delta` events and checked against the payload limit. No per-run override and no UI protocol. `packages/durable/src/registration.ts:18`, `packages/durable/src/execution.ts:195`                                        |
| Steering                      | supported | Persisted at turn boundaries with empty checkpoints; `run.steer()` and `DurableClient.steer()`. `packages/durable/src/runtime.ts:479`, `packages/client/src/durable.ts:281`                                                                                                                                     |
| Structured output             | partial   | Validated by core and buffered; only JSON-serializable outputs persist. `packages/durable/src/schema.ts:31`                                                                                                                                                                                                     |
| Model retry                   | supported | Opt-in registration policy, error-class limited (model/compactor only), attempt counters persisted. `packages/durable/src/registration.ts:87`, `packages/durable/src/schema.ts:81`                                                                                                                              |
| Compaction                    | partial   | Registration-only; protects the model window and rewrites the model-facing projection, but canonical history is preserved and still counts against the payload limit. No manual trigger. `packages/durable/src/types.ts:21`, `packages/durable/src/compaction.ts:56`, `packages/durable/src/loop-context.ts:32` |
| Tracing / observability       | supported | Agent observers keep working; durable adds a stable trace id and metadata, with a 16 KiB cap on submitted trace options. `packages/durable/src/trace.ts:11`, `packages/durable/src/trace-schema.ts:7`                                                                                                           |
| Graph DAG (agents as nodes)   | supported | Additive surface; not part of `Agent()` but part of durable's orchestration. `docs/packages/durable.md:257`                                                                                                                                                                                                     |
| Tasks, goals, owned subagents | supported | Additive surface (`defineTask`, `defineGoal`, `ctx.spawnAgent`), with their own checkpoint boundaries. `packages/durable/src/index.ts:2`, `docs/packages/durable.md:559`                                                                                                                                        |
| Pipeline / team recovery      | rejected  | Explicitly out of scope in the docs. `docs/packages/durable.md:567`                                                                                                                                                                                                                                             |
| MCP servers                   | rejected  | Discovery and calls are external effects without a durable boundary. `packages/durable/src/registration.ts:32`                                                                                                                                                                                                  |
| Provider tools                | rejected  | Provider-executed tools are not checkpointed separately from the model call. `packages/durable/src/registration.ts:33`                                                                                                                                                                                          |
| Dynamic tool indexes          | rejected  | Selection depends on embeddings/query and is not persisted, so replay could choose different tools. `packages/durable/src/registration.ts:34`                                                                                                                                                                   |
| Memory store / save policies  | rejected  | No transactional boundary with the external store. `packages/durable/src/registration.ts:27`                                                                                                                                                                                                                    |
| Lifecycle callbacks           | rejected  | Hooks may perform effects or mutate the run. `packages/durable/src/registration.ts:28`                                                                                                                                                                                                                          |
| Guardrails                    | rejected  | Policies can block/modify input or output and may call external services. `packages/durable/src/registration.ts:30`                                                                                                                                                                                             |
| Middleware                    | rejected  | Wraps model/tool calls and can mutate requests. `packages/durable/src/registration.ts:29`                                                                                                                                                                                                                       |
| Static `Document` context     | supported | Snapshotted into the run record at submission (`contextDocuments` hash + documents); replay verifies the registration still resolves the same hash and fails with a recovery error otherwise. `packages/durable/src/documents.ts`, `packages/durable/src/run-record.ts`                                         |

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

- Persist a memory read snapshot before the first model call; use it on replay.
- Model writes as explicit `memory` operations with idempotency keys and a recovery policy; evaluate
  the save policy only after the run's terminal checkpoint.
- **Checkpoint boundary:** read before the first model call; writes as operations; save-policy
  decision after the outcome commit.
- **Tests:** replay does not duplicate writes; a failed write blocks for reconciliation; a changed
  memory snapshot does not silently alter a replay.
- **Effort/risk:** L / high. Only worth it if applications ask for `Agent.memory` specifically.

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
4. **Memory stores with free-form write policies.** Without an idempotent write API, replay duplicates
   writes. Keep rejected until the store contract supports keys and conflict handling.
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
7. **Phase 7** — memory has the weakest cost/benefit until a store contract with idempotency exists.

Each phase should ship behind a registration flag while the docs mark it experimental, and each
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
