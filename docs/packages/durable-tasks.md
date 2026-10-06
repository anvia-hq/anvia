# Durable tasks and owned agent work

`@anvia/durable` supports custom tasks alongside durable agent runs. A task stores its
input, version, checkpoint, child ownership, waits, and outcome. Task handlers execute one
phase at a time; they do not restore JavaScript stacks after a restart.

This API is experimental. The HTTP handler and browser client expose custom-task submission,
signals, snapshots, tree streams, reconciliation, and cancellation alongside agent runs and static graphs. The durable cookbook remains excluded.

## Define and submit a task

Use schemas that accept their own JSON output unchanged. Non-JSON values and schema
transforms that change a persisted value on revalidation are rejected. Handlers receive the
validated input and checkpoint. Initializers and migrations must be pure.

```ts
import { z } from "zod";
import { defineTask, DurableRuntime } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";

const increment = defineTask({
  name: "increment",
  version: 1,
  input: z.number(),
  checkpoint: z.null(),
  output: z.number(),
  initial: () => null,
  run: async ({ input }) => ({ status: "completed", output: input + 1 }),
});

const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore("./tasks.sqlite"),
  tasks: [increment],
  maxConcurrentTasks: 4,
});
await runtime.resume();
const task = await runtime.submitTask(increment, {
  sessionId: "account-42",
  requestId: "increment-1",
  input: 10,
});
const result = await task.result(); // number: 11
```

Keep the runtime alive at application scope and close it at shutdown. Repeating a root
submission with the same session/request ID, task name, version, and normalized input
returns the original task. Conflicting reuse fails. Custom tasks sharing a session can run
concurrently; they do not share conversation history or inherit agent-session FIFO behavior.

`runtime.getTask(id)` reacquires a handle returning JSON. `runtime.listTasks({ sessionId,
after, limit })` pages root records (including their input/checkpoint), up to 100 per page.
`maxConcurrentTasks` limits executing custom phases independently of `maxConcurrentRuns`.

## Checkpoints, children, and joins

A handler returns one transition:

- `{ status: "pending", checkpoint }` commits the next phase and releases the current slot.
- `{ status: "waiting", checkpoint, wait }` commits a continuation and parks the task.
- `{ status: "completed", output }` validates and records the intended result.
- `{ status: "failed" | "cancelled", error }` records failure or cancellation intent and
  cancels unfinished owned children.

If the process dies before a transition commits, the handler re-enters with its previous
checkpoint. Phases must be replayable; use `effect()` for external work.

```ts
const sum = defineTask({
  name: "sum",
  version: 1,
  input: z.array(z.number()),
  checkpoint: z.enum(["spawn", "sum"]),
  output: z.number(),
  initial: () => "spawn" as const,
  run: async (ctx) => {
    if (ctx.checkpoint === "spawn") {
      const ids = ctx.input.map((value, index) => ctx.spawn(`item-${index}`, increment, value));
      return {
        status: "waiting",
        checkpoint: "sum" as const,
        wait: { type: "children", ids, policy: "allSettled" },
      };
    }
    let output = 0;
    for (const child of ctx.children()) {
      if (child.outcome?.status !== "completed") {
        return { status: "failed", error: "A child did not complete successfully." };
      }
      output += Number(child.outcome.output);
    }
    return { status: "completed", output };
  },
});
```

Register both `sum` and `increment` in `tasks`. `spawn()` persists child identity and its
submission event atomically, before returning its ID. A stable key belongs to its parent for
that parent's entire lifetime. Replaying the same spawn reuses the child; changing its name,
version, or normalized input conflicts. Include an iteration ID in keys for repeated work.
Child creation and the parent's next transition are separate commits, deliberately made
safe to replay by these keys.

A task can wait only on distinct direct children. This prevents dependency cycles. Trees
are limited to 1000 total nodes and depth 32; exceeding either limit fails creation without
partially inserting that child. There are no background/detached children in this version.

`allSettled` resumes the parent after every selected child is terminal. `failFast` marks
unfinished selected siblings for cancellation after the first failed/cancelled child, then
resumes the parent after those children settle. The handler decides its own outcome from
`ctx.children()`; a child failure does not automatically decide the parent's result.

A successful parent with unfinished children enters `completing`. A failed/cancelled parent
enters `cancelling`. Neither becomes terminal until all owned work and active callbacks have
settled. These states do not occupy custom phase capacity. Ready phases rotate fairly, and
the scheduler yields between phases so timers and cancellation can run.

Terminal outcomes are immutable, including failed children whose parent has already read
them. `task.retry()` only resumes `needs_attention` tasks after compatible code is restored;
it cannot restart terminal tasks. Submit a new root request for another attempt.

## Owned Anvia agents

Register agents through the existing `agents` option. A custom phase can create an agent
child with `ctx.spawnAgent("research", { agentId: "researcher", prompt: "Research ..." })`
and include its returned task ID in a child wait. Creation of the task and its agent run is
atomic. Every owned agent gets isolated durable session history and its own run ID.

The custom task slot is released while the agent works. Agent concurrency, model/tool
checkpoints, approvals, retry backoff, and manual tool recovery retain their existing
semantics. A successful response becomes the child's JSON output. Failed, cancelled, or
non-response terminal runs become unsuccessful task outcomes.

The child record exposes `agentRunId`, and its agent wait exposes the run's status. Status
changes appear in the task-tree stream. Use `runtime.getRun(agentRunId)` to inspect the
interaction and call `respond()` or `resolveTool()`. Cancelling the task tree also cancels
owned agent runs; cancelling an agent run settles its corresponding child task. Once the
child's outcome is decided, the owned run cannot be retried independently.

Use the existing run stream for model/tool progress: the task-tree stream contains task
submission and status changes, not every agent journal event. These generated run sessions
are reserved. The HTTP authorization callback maps owned agent runs to their parent task
session and includes `taskId`, `rootTaskId`, `taskName`, `runId`, and `agentId`.

## Durable effects

Use a stable effect key and include all relevant request arguments in its JSON input:

```ts
const receipt = await ctx.effect(
  "charge-order-42",
  { orderId: "42", amount: 100 },
  async (operationId, signal) => {
    return await payments.charge({
      orderId: "42",
      amount: 100,
      idempotencyKey: operationId,
      signal,
    });
  },
  "idempotent",
);
```

The engine commits intent before invocation and the JSON result after it returns. A
completed result is reused without executing the callback. Changing the saved input or
recovery policy blocks replay. Keys are scoped to a task's entire lifetime; concurrent use
of one key is rejected. Await every effect started by a handler before returning.

- `manual` (default): an interrupted intent needs external reconciliation.
- `safe`: an interrupted effect can run again.
- `idempotent`: reruns with the same `${taskId}/${key}` operation ID; the external service
  must enforce deduplication.

For a `needs_attention` task, inspect `task.snapshot().operations`, verify the actual external
result, then call `task.resolveEffect(key, verifiedJsonResult)`. Manual reconciliation resumes
the phase and reuses that result. A non-JSON callback result also blocks for recovery because
the external action may already have succeeded. An ordinary callback exception fails the
phase unless the handler handles it; this does not undo any external effect.

Persistence failures stop the runtime even if a handler catches the immediate exception.
Close and reopen storage before recovery. The engine cannot guarantee exactly-once external
effects and provides no automatic compensating actions.

## Timers and external signals

A timer parks a continuation without holding execution capacity:

```ts
return {
  status: "waiting",
  checkpoint: nextCheckpoint,
  wait: { type: "timer", until: new Date(Date.now() + 60_000).toISOString() },
};
```

The deadline survives restart. `runtime.resume()` reloads deadlines and schedules eligible
work. The host process still needs a supervisor to restart it; the engine does not boot a
server or wake a stopped machine.

For external input, return a signal wait:

```ts
return {
  status: "waiting",
  checkpoint: nextCheckpoint,
  wait: { type: "signal", name: "review-decision" },
};
```

Deliver with `await task.signal("review-decision", "delivery-123", { approved: true })`.
The continuation reads `ctx.signalValue("review-decision")`. Each name accepts one value for
the task's lifetime, including early delivery before the wait. An identical request/value
is idempotent; a different delivery conflicts. Use a fresh name for another iteration.
There are at most 1000 named signals per task. Names must be nonblank, trimmed, at most 256
characters, and cannot be `__proto__`.

## Inspection, cancellation, and version changes

`task.graph()` and `runtime.taskGraph(taskId)` return the owning root's complete bounded tree,
including completed nodes, ownership edges, current child-wait edges, and a global cursor.
`task.stream({ after: cursor })` streams committed changes for that tree, including children
created after attachment. Refresh the graph after events to obtain its current state.
A handle on a child also observes the whole root tree. Aborting `result()` or `stream()`
only detaches that subscriber.

`task.cancel()` atomically fences its subtree against new work, then aborts invocations.
Its result becomes terminal after callbacks settle; callbacks must cooperate with abort
signals for prompt shutdown. `runtime.close()` also waits for callbacks, but preserves
unfinished checkpoints for restart instead of recording cancellation.

Definition versions are positive integers. Reopening with a missing/older definition blocks
the task when it becomes runnable. A newer version needs a pure `migrate(input, checkpoint,
fromVersion)` function returning `{ input, checkpoint }` accepted by its current schemas.
Migration and activation commit together. Restore compatible code and call `retry()` for an
already blocked task. Migrations must preserve the meaning of saved effects and child keys;
there is no implicit rewriting of journals, children, or consumed outcomes.

SQLite schema 3 adds custom tasks and scheduling indexes. Acquisition upgrades schema 1 or
2 while retaining existing runs and static graphs. Older engines reject schema 3; downgrades
are unsupported. Custom stores must implement the new task transaction, listing, scheduling,
and event methods as well as the existing store contract.

Persisted token streaming, distributed workers, Postgres, automatic retention, execution deadlines,
Studio UI, and general migration tooling remain future work. Offline backup/restore and
operational controls are described in the [operations guide](./durable-operations.md). This package is not yet
being presented as production-ready.

## Remote task controls

`createDurableHandler` serves `/durable/tasks` alongside runs and static graphs:

| Method and path                  | Operation                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /tasks`                    | Submit `{ name, version, sessionId, requestId, input }` to a registered definition |
| `GET /tasks?sessionId=...`       | Paginated root tasks                                                               |
| `GET /tasks/:id`                 | Atomic snapshot and cursor                                                         |
| `GET /tasks/:id/graph`           | Entire ownership tree                                                              |
| `GET /tasks/:id/events`          | Reconnectable tree SSE; `after` or `Last-Event-ID`                                 |
| `POST /tasks/:id/signal`         | Deliver `{ name, requestId, value }`                                               |
| `POST /tasks/:id/resolve-effect` | Reconcile `{ key, value }`                                                         |
| `POST /tasks/:id/retry`          | Resume a task needing attention                                                    |
| `POST /tasks/:id/cancel`         | Cancel the selected subtree                                                        |

`DurableClient` exposes `submitTask`, `listTasks`, `taskSnapshot`, `taskGraph`, `streamTask`,
`signalTask`, `resolveEffect`, `retryTask`, and `cancelTask`. Define and register executable code
on the server; clients only select registered names/versions and supply JSON. For direct use,
`runtime.submitRegisteredTask()` provides the same serialized submission boundary.

Authorization remains mandatory for every request. Resources include the owning session,
`taskId`, `rootTaskId`, and `taskName`; owned agent resources also include `runId` and `agentId`.
Tree reads and cancellation authorize existing nodes. Cancellation returns HTTP 409 without
mutating the tree if children were created during authorization; retry the request to authorize
the new tree. In-process callers can use `cancel({ expectedTreeIds })` for the same identity fence.
Events reauthorize each emitting task,
including dynamically created children, before sending its record. Granting task submission or
retry authorizes execution of that registered definition, including its spawning behavior; use
an allowlist of trusted task names. A denial during streaming interrupts the stream without
exposing the denied event. Event envelopes include `rootId` and `taskId`; clients validate the
root and monotonically increasing cursor. Global operational metrics are not exposed by these routes.
