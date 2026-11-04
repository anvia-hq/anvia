# Durable runtime operations

`@anvia/durable` remains experimental. This release targets one supervised Node.js process,
one host, and a dedicated SQLite database on local storage. It requires Node.js 22.16 or newer.
Do not run multiple owners, share the file over a network filesystem, or use a restored copy
alongside the original deployment.

## Failure handling and health

```ts
const runtime = await DurableRuntime.open({
  store,
  tasks,
  agents,
  onFatalError(error) {
    supervisor.report(error);
  },
  limits: {
    maxPendingRuns: 10_000,
    maxPendingTasks: 10_000,
    maxPayloadBytes: 1_048_576,
    maxOperations: 10_000,
  },
});
await runtime.resume();
```

A storage read, write, admission, or commit error stops both schedulers, aborts active callbacks,
and rejects further work. It does not convert the interrupted execution to an ordinary failed
business outcome. A callback cannot catch a journal failure and continue committing. Close the
runtime, repair the underlying storage problem, then open and resume it. If ownership cleanup
also fails during close, restart the owning process through its supervisor before reopening;
do not forcibly clear a live-owner row. Existing recovery
policies still apply: models can repeat after an interrupted checkpoint; uncertain manual tools
and effects require reconciliation. There is no exactly-once guarantee for external services.

`onFatalError` fires once per failed owner. Errors thrown/rejected by the observer are ignored.
The observer receives the error/cause; apply your logging and redaction policy before recording it.
`runtime.health()` performs no database access and reports `ready`, `failed`, `closing`, or
`closed`, plus active agent/task counts. Readiness means the owner accepts work; it does not
certify that providers are reachable or that every registered definition is compatible with saved work.

`runtime.metrics()` returns status counts for runs/tasks, oldest unfinished work age, operation
and event totals, and allocated SQLite page bytes. The page count excludes WAL/SHM files; also
monitor filesystem free space and actual database/WAL sizes. Metrics scan aggregate tables;
scrape periodically (for example every 30 seconds), rather than on each request. Export these
through your own authenticated monitoring endpoint. The default HTTP handler exposes no global
health/metrics route because its authorization contract is session scoped.

Alert on readiness loss, growing queue age, `needs_attention`, `retry_wait`, `cancelling`, disk
pressure, and backup age. Waiting for approval or a signal is not itself an error. Cancellation
and shutdown are cooperative; application callbacks must honor their AbortSignal. A supervisor
must enforce its own shutdown grace period, then terminate a stuck process.

## Admission and payload limits

The defaults above are finite and configurable positive integers. Each one applies to a different
thing:

- `maxPayloadBytes` (1,048,576 bytes) bounds each persisted value, measured as UTF-8 encoded JSON:
  run prompt, trace, input, history, responses, steering, outcome, context checkpoint, and
  exhaustion; task trace, input, checkpoint, signals, and successful output; operation input and
  result; and `model_delta` events. It takes either one number for every field, or per-field
  budgets (see below).
- `maxPendingRuns` and `maxPendingTasks` (10,000 each) bound unfinished work, including owned
  children.
- `maxOperations` (10,000) bounds journal operations per run or task.
- HTTP `maxBodyBytes` (65,536 bytes) bounds each request body, measured as received bytes.

The payload limit is a per-field cap on a single write, not a session budget. The same content is
counted again wherever it is persisted: a prompt lives in `run.prompt`, again in `run.input`, again
in the model operation request with the provider/model envelope, and later in `history` and
`outcome`. A session therefore stops fitting well before any single prompt reaches
`maxPayloadBytes`. Budget for "prompt + history + request envelope ≤ `maxPayloadBytes`"; `run.input`
is usually the field that crosses first, and the error names it.

Effective budget per persisted field, with the default `maxPayloadBytes` of 1,048,576 bytes:

| Field                        | Counts                                          | What fills it                              |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------ |
| `run.prompt`                 | the new user message                            | the submitted prompt                       |
| `run.input`                  | prompt plus inherited session history           | history; usually the first field to cross  |
| `operation.input`            | the model request, including provider and model | history, system instructions, tool schemas |
| `run.history`, `run.outcome` | the settled conversation and final output       | every completed turn                       |
| `event.model_delta`          | one streamed chunk                              | very large single chunks                   |

Status events are not payload-checked. They are small by construction: they carry `status`,
`error`, `blockedOperation` and `nextAttemptAt`, but not the run's `outcome`. The outcome is stored
once, on the run, and clients read it from the run snapshot when a settled status arrives. A limit
on status events would stop a run from reaching `failed` or `needs_attention`. Journals written by
older versions still carry `outcome` on the event, and clients read that too.

`maxPayloadBytes` also accepts per-field budgets. A number applies to every field, as before. An
object sets budgets by group and falls back to `default` (1,048,576 bytes) for each group it omits:

```ts
limits: {
  maxPayloadBytes: { default: 1_048_576, prompt: 4_194_304, operation: 8_388_608, outcome: 4_194_304 },
}
```

| Key         | Fields it covers                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `prompt`    | `run.prompt`, `run.input` (the submitted prompt plus inherited history)                         |
| `operation` | `operation.input` (the model request), `operation.result` (model results and tool results)      |
| `event`     | `event.model_delta` (one streamed chunk)                                                        |
| `outcome`   | `run.outcome`, `run.history` (the settled conversation), `task.outcome`                         |
| `default`   | every other persisted field, including trace, responses, steering, checkpoints and task signals |

Groups are independent. Raising `prompt` does not raise `operation`, so a larger prompt still
fails on its model request unless `operation` is raised too. A prompt is also copied into
`run.history` and `run.outcome` after its turn, so raise `outcome` with `prompt` for the same
text. The error names the field and its effective limit, so the table is enough to find the
budget to raise. Status events are not checked (see above). Unknown keys and values that are not
positive integers are rejected when the runtime opens.

### Oversized payloads move to blob storage

A single payload leaf larger than 64 KiB — a tool result, a model response, an outcome's text or
output, or a large message part (text, reasoning, image or file data, tool-call input) — is stored
in a content-addressed blob table and replaced by a bounded reference in the journal record. The
payload checks above run on the stored form, so one oversized artifact no longer fails the run or
inflates the history that later runs in the session inherit. Models, tools, compaction, and
reconciliation always operate on the fully restored content; `run()`, `snapshot()`,
`operationRequest()`, and event reads restore references as well.

References are content-addressed and written in the same transaction as the record that points at
them, so a committed reference is never dangling and a replay produces byte-identical records. The
threshold is fixed at 64 KiB and does not follow `maxPayloadBytes`; a field made of many
below-threshold values is still bounded by its field budget, exactly as before. Blobs are never
garbage-collected: stores grow by the full size of every oversized payload. Media in a submitted
prompt is not externalized; it counts against the prompt budget at admission.

The HTTP body limit is the binding ceiling for uploads. Base64 images and long documents must fit
`maxBodyBytes` before the runtime sees them, and the default 64 KiB is far below the default payload
limit, so any image over about 48 KiB binary is rejected with 413 before the payload limit is
consulted. Raise `maxBodyBytes` to at least the largest encoded request you accept; the payload
limit still applies afterwards. `createDurableHandler` logs one startup warning when `maxBodyBytes`
is below the runtime's `maxPayloadBytes`, which is the case for the default setup. The warning is
advisory; configure and review the two limits together.

Pending limits include all unfinished states and owned children. Capacity checks and insertion
happen in one transaction; repeating an identical existing submission still succeeds at capacity. A
graph or child-agent creation that exceeds capacity rolls back atomically. Terminal executions
release capacity. Limits bound persisted values; they do not prevent application code from first
allocating a large object. Changes to control/status alone remain possible when limits are lowered
on restart. Failure diagnostics use a separate 4,096-character bound so a small payload quota cannot
prevent cancellation or failure propagation through an owned tree. Copying an owned agent output
that was already admitted with its run preserves that admission even after quotas are lowered.

Admission rejects with `DurableLimitError`, which carries a `code` and, for payload limits, the
`field` plus the `limit`/`actual` byte counts in the message and on the error. `payload_too_large`
can never succeed for the same request; `capacity_exceeded` clears as unfinished work settles. Over
the HTTP bridge, payload limits return 413 and capacity returns 429, both with
`{ error, code, field? }`; a request body over `maxBodyBytes` also returns 413 and includes the
limit. `DurableHttpError` in `@anvia/client` exposes `status`, `code`, `field`, and the server
message.

A run that cannot start because its prompt, input, or inherited history exceeds the payload limit
ends in terminal `failed`, not `needs_attention`: no work is pending, so there is nothing for an
operator to unblock. `run.result()` rejects with `DurableRunError` (`status: "failed"`) and the
event stream ends. Retrying such a run recomputes the inherited history from the session's latest
settled run before executing, so a retry never runs with less context than the original attempt;
when the history still does not fit, `retry()` rejects with the same `DurableLimitError` and the run
stays failed. Raise `maxPayloadBytes`, restart, and retry to continue the session.

An oversized external effect result leaves its started intent and blocks for reconciliation, rather
than silently running the effect again. An oversized checkpoint/transition blocks the task for
operator attention. Increase the limit and explicitly retry, or cancel it. Limits do not expire old
data: automatic retention and durable execution deadlines remain separate work. Do not delete
journal rows manually; deduplication, session history, event cursors, and recovery depend on them.

Custom stores now implement `pendingCounts()` and `operationCount()` inside transactions,
and `metrics()` outside them. All store failures are fatal; perform request validation before
calling a store. Transaction callbacks remain synchronous and atomic.

## Backup and restoration

```ts
import { backupSqlite, restoreSqlite } from "@anvia/durable/maintenance";

await runtime.close();
const info = await backupSqlite("./durable.sqlite", "./backup-2026-10-06.sqlite");
// Later, while the original deployment remains stopped:
await restoreSqlite("./backup-2026-10-06.sqlite", "./restored.sqlite");
```

Backups are offline maintenance operations. They accept an existing schema-3 or schema-4 database and
acquire its exclusive runtime ownership for the copy. Maintenance uses SQLite's backup API,
which includes committed WAL state and preserves row identities used by pagination. The copy
is integrity checked, sealed with creation time/schema metadata, checkpointed, closed, synced,
and published to a new file. Existing destination files/symlinks or SQLite WAL/SHM/journal sidecars are rejected. Use a
dedicated offline destination directory; other processes must not create sidecars there during
maintenance. Existing files are never replaced. Temporary
copies are private and final files have mode 0600. Protect the backup directory and encrypt backups
as appropriate: archives contain prompts, checkpoints, signals, and tool results.

A sealed archive cannot be opened as a runtime. Restore validates the archive and creates a new
unsealed database; it does not overwrite the live file or modify the archive. If directory sync
fails after publication, the operation reports an error but the destination may exist. Inspect it;
do not assume an error means no file was published. No remote upload or rotation is performed.

Stop the original deployment before restoration, restore compatible code and task definitions,
and inspect unfinished snapshots before `resume()`. The copy's ownership reset does not fence an
original runtime at a different path or host. External effects performed after the backup are not
in that snapshot. Reconcile them with the external service, using stable idempotency keys where
supported, before replay. Restoring old state cannot undo payments, emails, or other external work.

Practice restoration into an isolated environment with external side effects disabled. Verify
identities/cursors, completed effect reuse, waiting signals/timers, and agent approval recovery.
Choose a backup interval based on acceptable recovery-point loss, and measure recovery time.

## Upgrade, rollback, and rollout

1. Drain traffic, stop admission, close the runtime, and take a verified backup.
2. Keep the previous application artifact and matching task/agent definitions available.
3. Test the new application against a restored copy with external services isolated. Check
   compatible version registration and pure checkpoint migrations before opening live traffic.
4. Restart one owner, inspect readiness and blocked work, call `resume()`, then admit a small
   workload. Watch queue age, storage latency/free space, provider failures, and cancellations.
5. Expand traffic only after fault recovery, backup restoration, and sustained-load checks meet
   your service targets. Document the responsible operator and rollback trigger.

Schema 4 upgrades schemas 1–3 on acquisition. This maintenance API intentionally backs up only
schemas 3/4: take an infrastructure-level consistent offline snapshot before upgrading an older
schema. The current backup helper upgrades schema 3 to 4 when acquiring ownership. Older
engines reject schema 4; an application downgrade is safe only when its schema and saved
definitions remain compatible. Otherwise restore the prior backup to a new file and audit
post-backup external effects before resuming. There is no automatic downgrade migration.

Unit tests cover injected journal failures, process kills, bounded task load, cancellation,
remote authorization, and backup/restore. They do not replace a real disk-full/read-only drill,
a long-running workload on your target filesystem, or an operational recovery exercise. Complete
those before declaring the package production-ready. The durable cookbook remains withheld.
