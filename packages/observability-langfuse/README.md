# @anvia/langfuse

Langfuse tracing adapter for Anvia.

Use this package to attach Langfuse tracing to Anvia agents and to publish evaluation scores from Anvia eval reporters.

## Installation

```sh
pnpm add @anvia/langfuse @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/langfuse build
```

## Usage

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { langfuse } from "@anvia/langfuse";

const tracing = langfuse.create({
  publicKey,
  secretKey,
  baseUrl,
  environment,
  release,
});

const client = new OpenAIClient({
  apiKey,
});

const agent = new AgentBuilder("support", client.completionModel())
  .instructions("Answer support questions clearly.")
  .observe(tracing)
  .build();

const response = await agent.prompt("How do I reset my password?").send();

console.log(response.output);

await tracing.flush();
```

Use `flush()` after short-lived jobs. Use `shutdown()` when the process is exiting.

## Configuration

`langfuse.create()` accepts the following options. Any option that is
left undefined falls back to the matching environment variable, and
explicit options always win.

| Option        | Environment variable          | Notes                                                      |
| ------------- | ----------------------------- | ---------------------------------------------------------- |
| `publicKey`   | `LANGFUSE_PUBLIC_KEY`         | Required for score publishing.                             |
| `secretKey`   | `LANGFUSE_SECRET_KEY`         | Required for score publishing.                             |
| `baseUrl`     | `LANGFUSE_BASE_URL`           | Defaults to `https://cloud.langfuse.com`.                  |
| `environment` | `LANGFUSE_TRACING_ENVIRONMENT`| Tag attached to every trace.                               |
| `release`     | `LANGFUSE_RELEASE`            | Tag attached to every trace.                               |
| `serviceName` | `LANGFUSE_SERVICE_NAME`       | Recorded on the root observation and as the OTel `service.name` resource attribute. |

```ts
const tracing = langfuse.create({
  // All fields are optional and fall back to env vars.
  serviceName: "support-agent",
});
```

## Observation metadata

The adapter records extra data on Langfuse observations so the UI
shows everything the agent runtime emits:

- **Generation observations** carry `providerRequest` and `modelInfo`
  (with `provider`, `defaultModel`, and `capabilities`) on start, and
  `firstDeltaMs` on end. `usageDetails` always includes
  `cachedInputTokens` and `cacheCreationInputTokens`.
- **Generation observations** receive a `generation.update({ output: { delta } })`
  call for every streaming delta (`text_delta`, `reasoning_delta`,
  `tool_call`), so the Langfuse UI reflects partial output as the
  model produces it.
- **Tool observations** carry `toolDefinition` and `toolMetadata` on
  start, and `structuredResult` on end.
- **Root run observation** carries `serviceName` and the configured
  `metadata` from `AgentRunStartArgs`.

User-supplied `trace.metadata` always wins over the built-in fields
above (the spread order preserves it).

## Eval Scores

```ts
import { createLangfuseEvalReporter } from "@anvia/langfuse";

const reporter = createLangfuseEvalReporter(tracing);
```

The reporter reads trace information from eval output when available, then publishes metric scores to Langfuse.

### Typed scores and overrides

`tracing.score()` accepts a `dataType` (`"NUMERIC" | "CATEGORICAL" | "BOOLEAN"`), a `configId` (or its `scoreConfigId` alias), a per-score `environment` override, and a `timestamp` (Date or ISO 8601 string). The adapter validates `value` against the dataType at the boundary.

```ts
await tracing.score({
  traceId: trace.traceId,
  name: "verdict",
  value: "pass",        // string for CATEGORICAL
  dataType: "CATEGORICAL",
  configId: "cfg-1",
  environment: "staging",
  timestamp: new Date(),
});
```

The score fetch has a default timeout of 30 s, overrideable via
`langfuse.create({ timeoutMs: ... })`.

### Batching and retry (high-volume evals)

Enable the in-memory score queue by setting `scoreBatchSize` on
`langfuse.create()`. When enabled, `tracing.score()` enqueues the
score and returns immediately. The queue flushes when it reaches
`scoreBatchSize`, on a debounce timer (`scoreFlushIntervalMs`,
default 250 ms), and on `flushScores()`, `flush()`, or `shutdown()`.

```ts
const tracing = langfuse.create({
  publicKey,
  secretKey,
  scoreBatchSize: 20,             // enable queue; flushes at 20 items
  scoreFlushIntervalMs: 500,      // or after 500ms
  scoreMaxRetries: 3,             // retry 429 / 5xx with backoff
});

await tracing.score({ traceId, name: "quality", value: 1 });
await tracing.score({ traceId, name: "latency", value: 0.4 });
await tracing.flushScores();       // drain the queue
console.log(tracing.scoreQueueDepth()); // 0
```

`flush()` and `shutdown()` also drain the score queue. After all
retries are exhausted, the queue throws a `LangfuseScoreError` whose
`scores` property contains the failed payloads so you can inspect
what was lost.

## Event observations & trace handle

After a run starts, you can record ad-hoc checkpoints and attach
extra attributes to the active trace without threading the run
observer through every function call. The tracing instance exposes
the most recent trace through `getCurrentTrace()`:

```ts
import { langfuse } from "@anvia/langfuse";

const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });

await tracing.startRun({
  agentName: "support",
  prompt: { role: "user", content: [{ type: "text", text: "hi" }] },
  history: [],
  maxTurns: 3,
});

const trace = tracing.getCurrentTrace();

trace?.addEvent("retrieval.done", { docCount: 4 });
trace?.addEvent("validation.passed");
trace?.addAttributes({ quality: "high" });
```

`addEvent` creates a Langfuse `event` observation under the active
root and ends it immediately. `addAttributes` updates the root
observation's metadata. Both calls bubble up to Langfuse via the
existing OpenTelemetry span processor.

If you have the run observer returned by `startRun`, you can also
use its `event?(...)` hook (added in `@anvia/core`) to record
checkpoints:

```ts
const run = await tracing.startRun({
  agentName: "support",
  prompt: { role: "user", content: [{ type: "text", text: "hi" }] },
  history: [],
  maxTurns: 3,
});

await run.event?.({
  name: "retrieval.done",
  attributes: { docCount: 4 },
});
```

The trace handle is cleared when the run `end`s or `error`s. If you
call `addEvent` or `addAttributes` after that, the underlying
Langfuse SDK will reject the call because the root observation is
no longer accepting children. We let the error propagate so it is
visible.

`getCurrentTrace()` is per-tracing-instance and last-write-wins:
when multiple runs start on the same instance, the handle always
points at the most recent run. For true concurrency, manage your
own context (e.g. capture the run observer or build your own
mapping keyed on user/session).

## Exports

- `langfuse`
- `createLangfuseEvalReporter`
- `LangfuseScoreError`
- `LangfuseTracing`
- `LangfuseTraceHandle`
- `LangfuseTracingOptions`
- `LangfuseScoreArgs`
- `LangfuseScoreDataType`
- `LangfuseEvalReporterOptions`

## Development

```sh
pnpm --filter @anvia/langfuse typecheck
pnpm --filter @anvia/langfuse test
pnpm --filter @anvia/langfuse build
```
