# Main agents and runtime ownership

## One durable main agent

An `Agent` still defines the model, instructions, tools, and output schema. The durable
runtime owns submission, scheduling, history, operation checkpoints, and recovery. Supply
an application-configured `CompletionModel`; provider clients belong in provider adapters.

```ts
import { Agent } from "@anvia/core/agent";
import type { CompletionModel } from "@anvia/core/completion";
import { DurableRuntime } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";

export async function openAssistant(model: CompletionModel, databasePath: string) {
  const main = new Agent({
    id: "main",
    model,
    instructions: "Answer from the supplied information. State uncertainty explicitly.",
    maxTurns: 4,
    // Add static local tools here; see tools-and-recovery.md.
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(databasePath),
    agents: [{ agent: main, version: "main-v1" }],
    maxConcurrentRuns: 4,
    onFatalError: (error) => console.error("Durable owner failed", error),
  });
  await runtime.resume();
  return runtime;
}
```

Create this once in the server/worker startup path. Node.js 22.16+ is required. Use a dedicated
local database file, not `:memory:` for work that must survive restart. The process must stay
alive through the host server/worker; idle scheduler timers do not keep Node alive themselves.
On host shutdown, stop accepting submissions and await `runtime.close()`. That aborts active
attempts and retains unfinished work, rather than recording user cancellation. Callbacks must
honor cancellation for close to finish promptly.

Submission code, using that shared runtime:

```ts
const run = await runtime.submit(
  {
    agentId: "main",
    sessionId: "tenant-42:conversation-7",
    requestId: "message-123", // reuse this ID if the request is retried
    prompt: "Summarize the incident notes supplied in this message.",
  },
  { enqueue: true },
);
const snapshot = await run.snapshot();
// Return run.id to the caller; inspect progress/approvals separately from waiting for result().
```

An identical `(sessionId, requestId)` returns the original run; different agent/prompt values
under the same pair conflict. `enqueue: true` accepts a successor behind unfinished work;
without it an unfinished session rejects another submission. One run per session executes at
a time. Capacity is bounded across sessions. A queued run captures the latest completed session
history when it starts. Failed/cancelled predecessors add no partial conversation history.
Waiting for approval or recovery blocks successors in that session, but releases agent capacity.

Avoid `__anvia_graph__:` and `__anvia_task__:` session prefixes; they are reserved. Session IDs
organize history and deduplication, not authentication. Bind them to your application's tenant
and conversation authorization. Store the returned run ID with your application job if useful.

## Reopening and observing

```ts
const run = await runtime.getRun(savedRunId);
const snapshot = await run.snapshot();
renderSnapshot(snapshot); // application-owned renderer
for await (const event of run.stream({ after: snapshot.cursor, abortSignal })) {
  applyCommittedEvent(event); // application-owned event handler
}
```

`run.result({ abortSignal })` waits for a terminal outcome and throws `DurableRunError` for
failed/cancelled runs. It does not approve a tool or resolve a question. A run can remain
`waiting` or `needs_attention` indefinitely, so build an interaction/recovery path before
using `result()` as the sole completion mechanism. Snapshot state includes operations, usage,
errors, `blockedOperation`, and any pending interaction.

`run.stream()` yields persisted `submitted`, `status`, `model_started`, `model_completed`,
`tool_started`, and `tool_completed` events. It does not provide `textStream` or the live token
events of `agent.stream()`. Use these events for job progress, then render saved output. Detaching
or aborting a stream/result waiter leaves execution running; use `run.cancel()` to cancel it.
A reconnect starts from a fresh snapshot cursor or the last successfully applied event sequence.
Listing pagination cursors and event cursors are different values.

## Versioning and supported agent behavior

Use a stable agent ID and an explicit string registration version. Change the version when
model, instructions, tool behavior, schemas, or approval logic change incompatibly. A saved run
with a missing/different version enters `needs_attention`. Restore compatible code/version and
explicitly retry it; assigning an old version label to changed code is not a migration.

Agent execution permits static local tools and instructions. Registration rejects memory,
lifecycle callbacks, middleware, guardrails, context sources, MCP servers, provider tools, and
dynamic tool indexes. Durable history replaces the agent's separate memory option. Resolve
needed application input before submission through an appropriate trusted boundary; do not
silently insert nondurable context lookups into replay-sensitive tool definitions or schemas.
Observability callbacks can repeat during reconstruction and must not drive business effects.

Skills used by a coding assistant (including this skill) are authoring guidance. If you also
attach `Agent.skills` at runtime, inspect the tools it injects: the same purity, static-tool,
recovery, and permission requirements apply. Running a skill script is not automatically a
safe or idempotent external operation.

Optional `modelRetry` is configured on the registration, for example:

```ts
modelRetry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 30_000 }
```

The policy is captured at submission. Each model operation has a persisted attempt budget;
crashes consume an attempt. Backoff waits release capacity and survive restart. This retries
completion-attempt errors, including permanent provider/validation/observer failures: it has
no transient classifier or jitter. Tool failures and storage failures use different recovery
paths. An explicit `run.retry()` resets unfinished model-attempt counters, not completed results.
Do not use an unbounded application retry loop around an uncertain external operation.
