# @anvia/server

## 1.3.5

### Patch Changes

- fd80238: Evict closed in-memory resumable streams: remove closed streams after a configurable TTL and cap the number of retained closed streams (oldest first). Running streams are never evicted.
- 09d2235: Validate the resumable stream `after` cursor as a nonnegative safe integer. Invalid cursors now return a typed 400 error instead of silently returning all or no records with a normal end envelope.
- c4f9f3b: Reject reopening a running resumable stream instead of silently discarding its history. Reopening a closed stream id still resets it to a fresh running stream.

## 1.3.4

### Patch Changes

- 4015eca: Group durable work under an application-chosen observability session. Durable `trace` options accept `sessionId`, which observers such as Lens use to group traces, for example every turn, goal round, subagent, retry, and resumed attempt of one chat. Task-owned runs, including goal rounds and spawned subagents, use the root task's value. It only affects observers: execution sessions, histories, and ownership stay separate, each run keeps its own trace, and `metadata.durableSessionId` records the execution session when the two differ. Without it, the submitted session is used as before. Application `trace.metadata` keys named after runtime-owned durable keys (`durableRunId`, `durableEpoch`, `durableSessionId`, `durableTaskId`, `durableRootTaskId`, `durableGraphId`) are now always dropped, so they cannot pose as runtime identifiers on runs where the runtime does not set them. `createDurableHandler()`'s `trace(request, resource)` hook can return it. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.12.

## 1.3.3

### Patch Changes

- d65e000: Trace durable runs cleanly in Lens and other observers. Every execution of a durable run (model retries, crash recovery, explicit retries, and resumed interactions) now shares one trace ID derived from the run ID. The trace is grouped under the submitted session, including task-owned, goal, and graph agent runs, and carries `durableRunId`/`durableEpoch` (plus task or graph IDs) in its metadata. `submit()`, `submitTask()`, `submitGoal()`, and `submitRegisteredTask()` accept an optional `trace` (`name`, `userId`, `tags`, `metadata`, `version`, up to 16 KiB).

  Core's execution protocol gains an optional `replayed()` query. Model, tool, and context steps restored from a checkpoint no longer start observer spans or add to observer-reported usage, so a recovered run no longer shows phantom tool spans or duplicated token usage. `@anvia/otel` records `anvia.run.id` when a run starts, so failed or interrupted runs can still be correlated.

  `@anvia/server`'s `createDurableHandler()` gains a `trace(request, resource)` option to set trace context for authorized submissions. HTTP clients cannot set `trace` themselves, so `@anvia/client` submission types omit it. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.11.

## 1.3.2

### Patch Changes

- c2d1454: Add continuing goal rounds. `defineGoal({ rounds: "continue" })` keeps one conversation across a goal's sessions: each session after the first continues the previous session's conversation, including a turn-limited session's partial work, with a short continuation prompt. Assessors receive `session.roundMessages` with only the round's own messages, so an application can let the agent declare completion itself. Owned agent children accept `continueFrom` to continue a finished sibling's conversation. The default `rounds: "fresh"` is unchanged. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.10.

## 1.3.1

### Patch Changes

- c4254d4: Add running-goal controls. Goals now read indexed `pause:N`, `edit:N`, and `message:N` signals before admitting each session: a pause stops after the current session with pause reason `requested`, an edit replaces the objective or acceptance criteria for later sessions and assessments, and a message reaches exactly one later session. `goalControlSignal(task, family)` returns the next unused signal name. Goals persisted by earlier versions continue unchanged. Assessments may also return `context`, which reaches the next session inside `previous`, so later sessions can build on the previous answer and changed files. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.8 and 0.9.

## 1.3.0

### Minor Changes

- f03bcbf: Add durable queued steering through `run.steer()`, `runtime.steer()`, and the HTTP client/handler. Steering accepts user prompts or messages, persists receipts and application boundaries, and optionally deduplicates delivery by request ID. Replay preserves saved requests and completed effects; pending approval and recovery decisions remain explicit, and steering respects the original turn budget.

  Upgrade core and durable together for internal execution protocol 4. SQLite schemas 1–8 upgrade to schema 9; existing runs retain their original execution behavior, while newly submitted runs support steering. The HTTP packages require the matching durable release for steering protocol exports.

## 1.2.6

### Patch Changes

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

## 1.2.5

### Patch Changes

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

## 1.2.4

### Patch Changes

- 676050a: Add durable goals that continue across bounded agent sessions with persisted handoffs,
  application-verified completion, cumulative model-turn budgets, admission token/deadline limits,
  stall detection, and explicit signal-based resumption. Preserve typed turn exhaustion and partial
  messages, and expose capped owned-agent spawning and direct child run inspection.

  SQLite journals upgrade to schema 7; older engines reject upgraded databases.
  Allow the new durable minor line in client/server peer dependencies.
  Document goal orchestration in the bundled durable skill.

## 1.2.3

### Patch Changes

- 0f2a6a6: Add opt-in conversation compaction on durable agent registrations. Summarize completed history
  while retaining recent complete turns and preserving canonical messages. Persist summary
  checkpoints, projected input, usage, and progress atomically for recovery, with bounded summary
  attempts using the model retry policy.

  SQLite schemas 1–5 upgrade to schema 6 when acquired. Use matching durable runtime and protocol
  consumers; older engines reject the upgraded database. Compaction runs between session runs and inside active tool loops; graph tasks remain excluded.

  Allow the durable 0.4 minor line in client and server peer compatibility ranges.

## 1.2.2

### Patch Changes

- 9320061: Accept core structured user messages as durable prompts, enabling image and document inputs in runs, graph tasks, and owned agents. Validate multimodal content, preserve it across history and recovery, and compare request identities by canonical JSON. Existing string prompts remain supported. Allow the durable 0.3 release line in the client and server peer ranges.

## 1.2.1

### Patch Changes

- ee52a9f: Declare compatibility with both durable 0.1 and 0.2 through an optional peer range. Keep client and server on their existing major versions when durable receives a minor release.

## 1.2.0

### Minor Changes

- a1c7b45: Fail closed on durable storage errors across agent and custom-task execution. Add readiness,
  aggregate metrics, configurable admission/payload/operation limits, and offline SQLite backup
  and restoration to new files. Durable now requires Node.js 22.16 or newer and custom stores
  must implement capacity-count and metrics methods.

  Expose registered custom-task submission, snapshots, ownership graphs, signals, effect
  reconciliation, retry, cancellation, and reconnectable events through the server and browser
  client. Map owned agent authorization to its parent session and include root task identity
  in task event envelopes. The durable package remains experimental.

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

## 1.1.5

### Patch Changes

- a32e40c: Refresh package READMEs with concise product overviews, current quickstarts, and links to detailed guides. Publish the updated documentation on npm.

## 1.1.4

### Patch Changes

- 13e7346: Keep well-known diagnostic fields on JSONL and SSE error events. `code`,
  `retryable`, and JSON-safe `details` are now copied explicitly because
  runtime-specific Error subclasses (for example `bun:sqlite`'s `SqliteError`)
  define them on the prototype, where `JSON.stringify` drops them, which also made
  such payloads invalid under the client protocol. Non-JSON-safe thrown values
  degrade to a `{ message }` payload instead of serializing as `{}`. `errorEvent`
  is now exported publicly.

## 1.1.3

### Patch Changes

- 0d9bce0: Declare compatible workspace peer ranges so additive internal dependency releases do not force major releases of dependents.

## 1.1.2

### Patch Changes

- @anvia/client@1.1.2

## 1.1.1

### Patch Changes

- @anvia/client@1.1.1

## 1.0.11

### Patch Changes

- @anvia/client@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [c8bea68]
  - @anvia/client@1.0.10

## 1.0.9

### Patch Changes

- @anvia/client@1.0.9

## 1.0.8

### Patch Changes

- @anvia/client@1.0.8

## 1.0.7

### Patch Changes

- @anvia/client@1.0.7

## 1.0.6

### Patch Changes

- @anvia/client@1.0.6

## 1.0.5

### Patch Changes

- c7fb0f8: Declare and verify Bun 1.3.14 runtime compatibility for the built packages, public Core exports,
  Client and Server streaming, OpenAI SDK transport and media paths, and MCP HTTP/SSE and stdio
  transports. Make structured tool output branding stable across multiple Core module instances.
- Updated dependencies [c7fb0f8]
  - @anvia/client@1.0.5

## 1.0.4

### Patch Changes

- @anvia/client@1.0.4

## 1.0.3

### Patch Changes

- @anvia/client@1.0.3

## 1.0.2

### Patch Changes

- @anvia/client@1.0.2

## 1.0.1

### Patch Changes

- @anvia/client@1.0.1

## 1.0.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
- Updated dependencies [9ae0893]
- Updated dependencies [0292ede]
- Updated dependencies [a90416c]
- Updated dependencies [475ae22]
- Updated dependencies [c7f4bbc]
- Updated dependencies [45882ab]
- Updated dependencies [45882ab]
- Updated dependencies [640dd3c]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
  - @anvia/client@1.0.0

## 1.0.0-rc.11

### Patch Changes

- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/client@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- @anvia/client@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- @anvia/client@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- @anvia/client@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [6341fd8]
  - @anvia/client@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- @anvia/client@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- Updated dependencies [e96d038]
  - @anvia/client@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- @anvia/client@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- Updated dependencies [475ae22]
  - @anvia/client@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
- Updated dependencies [9ae0893]
- Updated dependencies [c7f4bbc]
- Updated dependencies [640dd3c]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
  - @anvia/client@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @anvia/core@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0

## 0.7.6

### Patch Changes

- 0b8c4bb: Use the consumer's `@anvia/core` installation from React and Server so Studio targets do not
  resolve incompatible Agent and Pipeline class declarations from nested Core versions.

## 0.7.5

### Patch Changes

- Updated dependencies [461a04d]
  - @anvia/core@0.26.0

## 0.7.4

### Patch Changes

- Updated dependencies [615b767]
  - @anvia/core@0.25.1

## 0.7.3

### Patch Changes

- Updated dependencies [36f8324]
  - @anvia/core@0.25.0

## 0.7.2

### Patch Changes

- Updated dependencies [e55a792]
  - @anvia/core@0.24.0

## 0.7.1

### Patch Changes

- Updated dependencies [1285e70]
  - @anvia/core@0.23.0

## 0.7.0

### Minor Changes

- cf1dff7: Add model-aware context limits and provider-reported active context usage to completion responses,
  agent results, streams, persisted generation metadata, memory-backed agent sessions, React hooks,
  server UI streams, and a React context meter primitive.

### Patch Changes

- Updated dependencies [cf1dff7]
  - @anvia/core@0.22.0

## 0.6.0

### Minor Changes

- 1ff8304: Add first-class stream resume to the shared request and response APIs.

  `UIStreamRequest` now includes optional `resume: { streamId, after }`. `@anvia/server` adds a
  `createEventStream({ resume })` / `createUIStreamResponse({ resume })` overload so routes can
  continue in-flight streams without manually composing `resumeStreamEvents`.

### Patch Changes

- Updated dependencies [1ff8304]
  - @anvia/core@0.21.0

## 0.5.18

### Patch Changes

- Updated dependencies [f7eef6c]
  - @anvia/core@0.20.0

## 0.5.17

### Patch Changes

- Updated dependencies [d570f84]
  - @anvia/core@0.19.0

## 0.5.16

### Patch Changes

- Updated dependencies [eff30fb]
  - @anvia/core@0.18.0

## 0.5.15

### Patch Changes

- Updated dependencies [693ce2a]
  - @anvia/core@0.17.0

## 0.5.14

### Patch Changes

- Updated dependencies [32634d6]
  - @anvia/core@0.16.0

## 0.5.13

### Patch Changes

- Updated dependencies [ca24a5e]
  - @anvia/core@0.15.0

## 0.5.12

### Patch Changes

- Updated dependencies [d9ac48c]
  - @anvia/core@0.14.0

## 0.5.11

### Patch Changes

- Updated dependencies [9e190bc]
- Updated dependencies [ede828b]
  - @anvia/core@0.13.5

## 0.5.10

### Patch Changes

- Updated dependencies [d196025]
  - @anvia/core@0.13.4

## 0.5.9

### Patch Changes

- Updated dependencies [8b7fe0d]
  - @anvia/core@0.13.3

## 0.5.8

### Patch Changes

- Updated dependencies [b5f285a]
  - @anvia/core@0.13.2

## 0.5.7

### Patch Changes

- 433f642: Simplify optional object construction across runtime integrations without changing public behavior.
- Updated dependencies [433f642]
  - @anvia/core@0.13.1

## 0.5.6

### Patch Changes

- Updated dependencies [b52c479]
  - @anvia/core@0.13.0

## 0.5.5

### Patch Changes

- Updated dependencies [26efea0]
  - @anvia/core@0.12.8

## 0.5.4

### Patch Changes

- Updated dependencies [b54fba5]
  - @anvia/core@0.12.7

## 0.5.3

### Patch Changes

- Updated dependencies [70ae42c]
  - @anvia/core@0.12.6

## 0.5.2

### Patch Changes

- Updated dependencies [384c8f0]
  - @anvia/core@0.12.5

## 0.5.1

### Patch Changes

- Updated dependencies [327261f]
  - @anvia/core@0.12.4

## 0.5.0

### Minor Changes

- 3236568: Add resumable chat stream support with server-side resumable event envelopes, replay/tail helpers,
  an in-memory resumable stream store, and `useChat({ resume })` client resume state.

## 0.4.10

### Patch Changes

- Updated dependencies [6cd352e]
  - @anvia/core@0.12.3

## 0.4.9

### Patch Changes

- Updated dependencies [7b398eb]
  - @anvia/core@0.12.2

## 0.4.8

### Patch Changes

- Updated dependencies [2735197]
  - @anvia/core@0.12.1

## 0.4.7

### Patch Changes

- Updated dependencies [eed8b5f]
  - @anvia/core@0.12.0

## 0.4.6

### Patch Changes

- 264b92d: Restore React human-input hook state, harden overlapping chat sends, make fetch transports avoid implicit GET/HEAD bodies, and validate server-sent event control fields.

## 0.4.5

### Patch Changes

- Updated dependencies [32171dc]
  - @anvia/core@0.11.3

## 0.4.4

### Patch Changes

- Updated dependencies [730c23d]
  - @anvia/core@0.11.2

## 0.4.3

### Patch Changes

- Updated dependencies [9fc55c9]
  - @anvia/core@0.11.1

## 0.4.2

### Patch Changes

- Updated dependencies [4068a2a]
  - @anvia/core@0.11.0

## 0.4.1

### Patch Changes

- Updated dependencies [9e4de00]
  - @anvia/core@0.10.0

## 0.4.0

### Minor Changes

- ca25fca: Add the shared UI message stream protocol for React-facing completions and agents.

  `@anvia/core` now exposes `@anvia/core/ui` with UI message types, core/UI message conversion helpers, and adapters for completion and agent streams. `@anvia/server` adds `createUIStreamResponse`. `@anvia/react` now standardizes `useChat` and `useCompletion` around `UIMessage[]` state and the `{ messages, stream: true }` request shape.

### Patch Changes

- Updated dependencies [ca25fca]
  - @anvia/core@0.9.0

## 0.3.1

### Patch Changes

- b80f013: Refactor stream helpers into focused internal modules, add coverage-gated tests, and omit stack traces from default streamed server error events.

## 0.3.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

## 0.2.0

### Minor Changes

- eb90638: Add server stream response helpers and React client transports for JSONL and Server-Sent Event agent streams.
