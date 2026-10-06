# @anvia/durable

## 0.2.0

### Minor Changes

- 8875630: Add opt-in durable agent streaming with persisted generation deltas, unique model-attempt identities, and validated streamed response checkpoints. Preserve completed model/tool results across retries and restarts, and support reconnecting through the existing event cursor APIs. Upgrade SQLite records to schema 4 and the core execution protocol to version 2.

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
