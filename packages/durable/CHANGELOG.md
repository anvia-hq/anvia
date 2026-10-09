# @anvia/durable

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
