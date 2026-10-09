# @anvia/durable

Run Anvia agents with persisted model and tool checkpoints. Submit work, observe its
progress, and recover unfinished runs after a process restart.

Experimental: this first version supports one runtime owner per local SQLite database,
static local tools, and committed progress events, with opt-in persisted token streaming.

## Install

```sh
pnpm add @anvia/durable @anvia/core @anvia/openai zod
```

SQLite requires Node.js 22.16 or newer. Use the accompanying core release with the
durable execution protocol; older core versions are rejected when importing this package.

### Registering configurations without restarting

`runtime.registerAgents(registrations)` validates the complete batch before adding any
agents. It uses the same validation as `open()`, rejects duplicate or already registered
IDs, and leaves running work and concurrency limits unchanged. Give each immutable
configuration its own agent ID; this API never replaces an existing implementation.
Custom tasks and graph submissions see the same registrations.

`runtime.unregisterAgent(id)` removes an idle registration and returns whether it existed.
It throws `DurableConflictError` if a run still needs that agent (including queued work,
approvals, retry waits, recovery blocks, and cancelled attempts still settling).
Removal preserves journal history, results, and deduplication records. Re-register
compatible code before retrying a failed run or submitting/spawning new work. Future task
phases must not depend on an unloaded registration unless the host restores it first.

Registrations are process-local. At startup, open without agents, discover unfinished
runs with `listRuns()`, restore their exact registrations, then call `resume()`.
Adding a missing registration does not automatically retry `needs_attention` runs;
recovery remains an explicit `retry()` decision. Custom task definitions still must be
provided to `open()`.

## Quickstart

```ts
import { Agent } from "@anvia/core/agent";
import { DurableRuntime } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const researcher = new Agent({
  id: "researcher",
  model: client.completionModel({ modelId: "gpt-5.6", api: "responses" }),
  instructions: "Produce a concise research brief from the supplied material.",
});

const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore("./anvia-runs.sqlite"),
  agents: [{ agent: researcher, version: "1" }],
  maxConcurrentRuns: 4,
});

try {
  await runtime.resume(); // discover unfinished work from the previous process
  const run = await runtime.submit({
    agentId: researcher.id,
    sessionId: "research-session",
    requestId: "research-job-42",
    prompt: "Summarize these research notes: ...",
  });

  for await (const event of run.stream()) {
    console.log(event.type, event.data);
  }
  const outcome = await run.result();
  if (outcome.type === "response") console.log(outcome.output);
} finally {
  await runtime.close();
}
```

Keep the runtime alive at application scope in a server. A client disconnect should close
only that client's subscription. Call `run.cancel()` to explicitly cancel the work.

## Image and document input

Durable prompts use the core `AgentPrompt` contract: a nonblank string or a
structured `UserMessage`. Existing string submissions keep their behavior. To send
an image directly to the model, use an image part:

```ts
const run = await runtime.submit({
  agentId: researcher.id,
  sessionId: "image-chat",
  requestId: "image-message-1",
  prompt: {
    role: "user",
    content: [
      { type: "text", text: "Describe this image." },
      {
        type: "image",
        image: { type: "data", data: imageBase64 }, // raw base64, without a data-URL prefix
        mediaType: "image/png",
      },
    ],
  },
});
```

Image URLs use `image: { type: "url", url: "https://example.com/image.png" }`.
Core file parts work too. Media-only user messages are accepted; empty messages,
non-user roles, and invalid content parts are rejected. The selected model must
support image or document input as appropriate. Validation and capability checks
use the core contracts; durable execution does not fetch or transform media.

The same prompt format works in graph tasks and `ctx.spawnAgent`. Graph dependency
results are appended as text without replacing media parts or user metadata.
Prompts and their media content are persisted for restart, retry, and later session
history. An equivalent JSON prompt deduplicates under the same request ID regardless
of object-key order; changing the content or metadata conflicts. Inline data captures
the bytes. URLs remain external references and must stay accessible and stable for
retries and future turns.

Set the runtime's `limits.maxPayloadBytes` and, when using the HTTP bridge,
`maxBodyBytes` to fit your application's upload policy. Base64 encoding increases
payload size, and history/model checkpoints also count toward runtime payload limits.
This release reads existing text-only journals; older releases cannot read journals
containing structured prompts. Hosts reading `run.prompt` must handle both strings
and user messages.

## Streaming model output

Set `stream: true` on an agent registration to execute it with `agent.stream()`:

```ts
agents: [{ agent: researcher, version: "1", stream: true }];
```

The model must support streaming. The option is captured when each run is submitted and
also applies to graph nodes and owned agent tasks. Registrations without it use `generate()`.

`run.stream()` then includes `model_attempt_started`, `model_delta`, and
`model_attempt_failed` events. Each carries `operationId` and a unique `attemptId`.
A `model_delta` has an `event` containing a normalized core generation event, such as
`{ type: "text_delta", turn: 1, delta: "Hello" }`, reasoning, or tool-call progress.
Deltas are persisted before subscribers can read them. `model_completed` carries the same
attempt ID and the validated normalized response; only this response is a model checkpoint.
The response commits before local completion observers run. A later observer failure fails
the run while retaining that checkpoint. `model_attempt_failed.failureKind` distinguishes
`model` execution/validation errors from `local` observer or persistence failures.

Partial output is provisional. On a new `model_attempt_started` for the same operation,
replace the previous attempt's partial output. Discard partial output on
`model_attempt_failed` or run cancellation. A crash or shutdown can leave an attempt without
a failure event; recovery starts a new attempt rather than continuing the previous token stream.
Completed checkpoints are reused without emitting duplicate deltas.

Reconnect using the last successfully applied event cursor, or replay `run.stream()` from
zero to reconstruct partial output. Snapshots contain completed responses and the latest
operation attempt ID, but do not include partial token text. Starting after a fresh snapshot's
cursor skips earlier deltas. Structured output follows core's buffering rules: text is not
exposed before schema validation, and the saved result arrives in `model_completed`.

Persisting each exposed delta adds SQLite writes and retained event data. The payload limit
applies to each delta; configure model output limits and database retention in the host application.
SQLite schema 5 includes streaming and compaction records; schemas 1–4 upgrade on acquisition.
Older engines reject schema 5. Use the matching core release with execution protocol version 2.

## Conversation compaction

Configure `compaction` on the durable registration, rather than `Agent.memory`:

```ts
import { createSummaryMemoryCompactor } from "@anvia/core/memory";

const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore("./anvia-runs.sqlite"),
  agents: [
    {
      agent: researcher,
      version: "researcher-with-compaction-v1",
      compaction: {
        trigger: { afterTokens: 32_000 },
        retention: { recentTurns: 3 },
        compactor: createSummaryMemoryCompactor({
          model: researcher.model,
          maxTokens: 2_000,
          retries: false,
        }),
      },
    },
  ],
});
```

This is opt-in. A new session run first loads the latest completed history. If the
model-facing projection plus the incoming prompt exceeds `trigger.afterTokens`, the runtime
summarizes an older prefix and retains complete user-led turns (default one; zero is allowed).
A user message and all its following assistant/tool messages remain together. No older prefix
means compaction is skipped. A later compaction includes the previous summary and advances its
covered-message count. Graph tasks have independent dependency-enriched input and are not compacted.

The default counter is core's approximate `estimateMemoryTokens`. Supply `tokenCounter` for a
model-specific count; it must be deterministic, return a nonnegative safe integer, and honor the
same semantics after restart. The threshold covers history and the incoming prompt, not agent
instructions, tool schemas, or output reservations. Budget for those separately. Compaction runs
only before the initial model call of a submission, not within its tool loop or approval
continuations. It does not guarantee that a large incoming prompt, retained turn, or subsequent
tool result fits the model window. There is no manual-compaction API in this release.

`run.history` and `outcome.messages` retain canonical messages. `run.contextCheckpoint` contains
only the latest summary and the number of canonical history messages it covers; `run.input`
contains the model-facing projection. Compaction never deletes or rewrites canonical history,
and does not reduce journal storage requirements or bypass payload limits. Omitting compaction
on a future registration sends the full canonical history again.

The serializable policy is captured at submission. Restore the same compactor and token counter
implementation after restart, and bump `registration.version` when either changes. A queued run
selects its predecessor's checkpoint when it starts. The summary, prepared input, successful
summary usage, and `compaction_completed` event commit atomically. Even a skipped preparation is
persisted, so retries cannot change the model input. Approved continuations reuse their saved
context. Failed or cancelled runs do not advance the next run's conversation checkpoint.

`compaction_started` and `compaction_completed` are persisted progress events. Completion includes
core's `MemoryCompactionInfo` token/message counts and usage; counts describe the projection,
while the checkpoint's count refers to canonical messages. Successful summary usage is added once
to the run total, without consuming its main-model turn budget. An interrupted, uncommitted
summary may be requested again and incur another provider charge; its unknown usage cannot be
reconstructed. Compactors must be safe to repeat and honor `abortSignal`.

`modelRetry`, when configured, also bounds summarizer calls and invalid summary results with
persisted attempts/backoff. Counter, quota, and journal errors are not provider retries. An
empty summary fails before the main model call and leaves canonical history intact. Explicit
`run.retry()` resets unfinished model and compaction attempt budgets while preserving committed
results. Compaction does not enable the otherwise unsupported agent memory/lifecycle callbacks.

## What survives a restart

- Submissions, deduplicated by `(sessionId, requestId)`; changed content with the same ID is rejected.
- Completed normalized model responses and tool results, reused during recovery.
- Pending approvals and questions, with responses accepted once per interaction ID.
- Session history, operation IDs, model-turn counts, usage, and progress-event cursors.
- Explicit cancellations, which are never restarted automatically.

Interrupted model requests may be sent again. A provider may bill both attempts; usage
records only completed responses received and committed by this runtime.

Tools default to `manual` recovery. Mark read-only tools `safe`, or use `idempotent` only
when the external service deduplicates requests using `context.operationId`:

```ts
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore("./anvia-runs.sqlite"),
  agents: [
    {
      agent: researcher,
      version: "1",
      toolRecovery: { search: "safe", createTicket: "idempotent" },
    },
  ],
});
```

The tools in `toolRecovery` must be registered on that agent. A committed tool result is
never executed again, regardless of policy. An interrupted `manual` tool becomes
`needs_attention`; inspect the external system and supply its actual result with
`run.resolveTool(operationId, output)`. Merely selecting `idempotent` does not make an API safe.

## Queues, inspection, and HTTP

Use `runtime.listRuns({ sessionId, status: "waiting", limit: 25 })` to discover pending
approvals. Listings also support agent/status filters and insertion cursors. Inspect the
full record with `runtime.getRun(id)` and `run.snapshot()`.

`runtime.submit(input, { enqueue: true })` persists a successor behind the current session
run. Different sessions execute up to `maxConcurrentRuns` (default 4). Approvals and recovery
blocks pause their session queue while freeing capacity for other sessions.

Opt into persisted model backoff on a registration:

```ts
{ agent: researcher, version: "1", modelRetry: {
  maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 30_000,
} }
```

The policy applies to model execution and completion-validation errors. Observer failures and
local response processing, checkpoint, and quota failures do not trigger another provider request.
Attempt counts include interrupted requests; retry deadlines survive restart. Tool recovery
policies remain separate.

`@anvia/server/durable` provides an authorized Fetch handler, and `@anvia/client/durable`
provides a browser-safe HTTP/SSE client. Reconnect using an atomic snapshot and its event
cursor. See the [HTTP guide](../../docs/packages/durable.md#http-server-and-client).

## Task graphs

`runtime.submitGraph({ sessionId, requestId, tasks })` creates a persisted static DAG.
Each task specifies `id`, `agentId`, `prompt`, and optional `dependsOn` task IDs. Independent
nodes run concurrently; a dependent starts only after all prerequisites return successfully.
Their committed outputs are supplied as JSON data in the dependent's input.

`graph.snapshot()` exposes nodes, edges, outputs, interactions, waiting reasons, and an event
cursor. `graph.stream()` emits committed task events; refresh the snapshot for live graph
state. Use each node's `runId` for existing approval, retry, and reconciliation methods.
`runtime.resume()` recovers eligible graph nodes after restart. Approvals and uncertain
external effects still require explicit decisions.

The HTTP client exposes `submitGraph`, `graphSnapshot`, `listGraphs`, `streamGraph`, and
`cancelGraph`. See the [task graph guide](../../docs/packages/durable.md#task-dependencies-and-exposed-graphs).
This version exposes graph data and execution;
Studio visualization and durable core Pipeline execution remain future work.

## Custom tasks and dynamic ownership

Use `defineTask()` for schema-validated input, checkpoints, and output. Register definitions
in `DurableRuntime.open({ store, tasks, agents })`, then call `runtime.submitTask()`.
A phase can spawn custom or agent children, persist a child join, wait for a timer or named
signal, and journal external effects with explicit recovery policies. Waiting phases release
capacity; cancelling a tree fences new work and waits for owned callbacks to settle.

`task.graph()` exposes the complete bounded ownership tree and current waits. `task.stream()`
emits committed tree changes. The HTTP/client integration also exposes custom-task submission,
signals, reconciliation, cancellation, snapshots, and graph/event reads. See the
[custom task guide](../../docs/packages/durable-tasks.md) for contracts, examples, and limits.

## Operational controls

Use `runtime.health()` for readiness, `runtime.metrics()` for aggregate status counts, and
`onFatalError` to notify your supervisor. Storage failures stop both schedulers and reject
new work. Configurable pending-work, payload, and operation limits bound admission.

`@anvia/durable/maintenance` provides offline `backupSqlite` and `restoreSqlite`; both write
new files only. See the [operations guide](../../docs/packages/durable-operations.md) for
restore, upgrade, rollback, and rollout procedures. The package remains experimental.

## Learn more

- [Execution, recovery, and API guide](../../docs/packages/durable.md)
- [Anvia overview](../../README.md)
