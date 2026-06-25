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

### Eval reporter options

```ts
const reporter = createLangfuseEvalReporter(tracing, {
  publishInvalid: false, // publish invalid outcomes as zero scores
  onMissingTrace: "ignore", // "ignore" | "warn" | "throw"
  truncateInputAt: 2048, // max bytes for case input/expected summaries
  includeMessages: true, // include output.messages in score metadata
});
```

- `onMissingTrace` decides what happens when no trace can be
  resolved for a case. `"ignore"` (default, also when `strict` is
  not set) drops the score silently. `"warn"` logs a
  `console.warn`. `"throw"` rejects with an error. The legacy
  `strict: true` option continues to work as an alias for
  `"throw"`.

- `truncateInputAt` caps the byte size of `caseInputSummary` and
  `caseExpectedSummary` metadata keys. Truncation appends
  `<truncated>` to the cut value.

- `includeMessages` controls whether `output.messages` (if present)
  is included in score metadata.

### Trace resolution

The reporter resolves a trace ID for each case in three tiers:

1. `output.trace` (most direct, set by an agent run).
2. `case.input.trace` (useful when the case input bundles trace
   info).
3. `case.metadata.traceId` (and optional `observationId`).

### Metric annotations

`EvalMetric` (in `@anvia/core`) accepts optional `dataType`,
`configId` / `scoreConfigId`, and `metadata` fields. The reporter
forwards them to Langfuse, so categorical or boolean metrics are
sent with the right shape:

```ts
import { defineMetric, EvalOutcome } from "@anvia/core";

const judge = defineMetric({
  name: "quality",
  dataType: "CATEGORICAL",
  configId: "quality-config",
  metadata: { source: "judge-llm" },
  evaluate: () => EvalOutcome.pass("good"),
});
```

`defineMetric` is a small identity helper that signals intent and
preserves type inference; plain object literals continue to work.

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

## Datasets & Experiment runs

Bridge `@anvia/core/evals` to Langfuse's dataset / experiment-run
workflow. The dataset client surfaces the four endpoints you need
to create a dataset, fetch its items, upsert items, and post a
batched dataset-run-items payload.

```ts
import {
  createLangfuseDatasetClient,
  runEvalAsExperiment,
  langfuse,
} from "@anvia/langfuse";

const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
const client = createLangfuseDatasetClient(tracing);

await client.createDataset({ name: "support-smoke" });
await client.upsertItems("support-smoke", [
  { id: "c-1", input: { q: "hi" }, expected: "hello" },
  { id: "c-2", input: { q: "bye" } },
]);

const dataset = await client.getDataset("support-smoke");
console.log(dataset.items);

await client.runExperiment({
  datasetName: "support-smoke",
  runName: "smoke-2026-06",
  run: (item) => ({
    output: `answer-for-${item.id}`,
    trace: { traceId: `trace-${item.id}` },
  }),
});
```

For eval suites, `runEvalAsExperiment` runs the suite and posts a
dataset run alongside the metric scores:

```ts
import { runEvalAsExperiment } from "@anvia/langfuse";

const { suite, datasetRun } = await runEvalAsExperiment(
  {
    name: "smoke",
    cases: [
      { id: "c-1", input: "a", expected: "A" },
      { id: "c-2", input: "b", expected: "B" },
    ],
    target: async (input) => input.toUpperCase(),
    metrics: [/* ... */],
    reporters: [/* existing reporters still score */],
  },
  {
    tracing,
    datasetName: "smoke-set",
    runName: "smoke-run",
  },
);

console.log(suite.passed, datasetRun.posted);
```

### Options

- `createLangfuseDatasetClient(tracing, options)`:
  - `publicKey`, `secretKey`, `baseUrl`: optionally override the
    tracing instance's resolved values. Falls back to env vars
    (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`).
  - `pageSize` (default `50`): dataset item pagination.
  - `timeoutMs` (default `30_000`): per-request timeout via
    `AbortSignal.timeout`.
- `client.runExperiment({ ... })`:
  - `items` (optional): supply items directly to skip the
    `getDataset` round trip.
  - `run`: invoked per item, returns `{ output, trace? }`.
    Per-item failures are caught and surfaced in the result's
    `errors` array; only successful items reach the batched POST.

### Failure handling

`runExperiment` continues on per-item errors. The `errors` array
contains `{ itemId, error }` entries for failed items; the POST
still goes out with the successful subset. Non-2xx on the
batched POST throws (and the items that already errored are
also included in the thrown error's context).

## Prompt management

Pull prompts from Langfuse's prompt store and link generations to
the prompt version. The tracing instance attaches the prompt name
and version to the root trace and every generation in the run
when a prompt ref is configured.

```ts
import { createLangfusePromptClient, langfuse } from "@anvia/langfuse";

const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
const prompts = createLangfusePromptClient(tracing);

const prompt = await prompts.getPrompt("support.system");
console.log(prompt.prompt, prompt.version);

await tracing.startRun({
  agentName: "support",
  prompt: { role: "user", content: [{ type: "text", text: "hi" }] },
  history: [],
  maxTurns: 3,
  promptRef: { name: "support.system", version: prompt.version },
});
```

`promptRef` is also accepted on `trace.metadata` (keys
`promptName` and `promptVersion`) for back-compat with users who
already attach metadata to `withTrace(...)`.

### Prompt client options

- `cacheTtlMs` (default `60_000`): in-memory TTL per
  `${name}::${version}::${label}` key.
- `timeoutMs` (default `30_000`): per-request timeout via
  `AbortSignal.timeout`.
- `publicKey`, `secretKey`, `baseUrl`: override the tracing
  instance's resolved values, falling back to env vars.

### Per-call options

- `getPrompt(name, { version?, label?, cacheTtlMs?, refresh? })`:
  - `version` and `label` filter the upstream request.
  - `cacheTtlMs` overrides the client default for this call.
  - `refresh: true` skips the cache and re-fetches.

### Helpers

- `getPromptText(name, options?)`: returns the prompt string;
  throws if the prompt is a chat prompt.
- `getPromptChat(name, options?)`: returns the chat message
  array; throws if the prompt is a text prompt.
- `refresh()`: clears the cache.

## PII redaction

Mask personally identifiable information in observations before it
leaves the process. The default pattern set catches emails,
credit cards (with Luhn validation), phone numbers, IPv4
addresses, JWTs, and common API key shapes.

```ts
import { langfuse } from "@anvia/langfuse";

const tracing = langfuse.create({
  publicKey: "pk",
  secretKey: "sk",
  redactInputs: true,
  redactOutputs: "deep",
});
```

- `redactInputs` redacts text on root inputs, chat history, and tool
  arguments.
- `redactOutputs` redacts generation output text and tool results.
- `"deep"` recurses into nested objects and arrays (in addition to
  top-level strings).

### Customizing

```ts
const tracing = langfuse.create({
  publicKey: "pk",
  secretKey: "sk",
  redactOutputs: true,
  redaction: {
    replacement: "[HIDDEN]",
    patterns: [
      { name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
    ],
  },
});
```

`createPiiRedactor(options)` is also exported for ad-hoc use:

```ts
import { createPiiRedactor } from "@anvia/langfuse";

const redactor = createPiiRedactor();
const safe = redactor.redactString("email alice@example.com today");
const safeMessages = redactor.redactMessages(messages);
const safeObject = redactor.redactObject(spanInput);
```

## Exports

- `langfuse`
- `createLangfuseDatasetClient`
- `createLangfuseEvalReporter`
- `createLangfusePromptClient`
- `runEvalAsExperiment`
- `LangfuseScoreError`
- `LangfuseTracing`
- `LangfuseTraceHandle`
- `LangfuseTracingOptions`
- `LangfuseScoreArgs`
- `LangfuseScoreDataType`
- `LangfuseEvalReporterOptions`
- `LangfuseDatasetClient`
- `LangfuseDatasetClientOptions`
- `LangfuseDataset`
- `LangfuseDatasetItem`
- `LangfuseRunExperimentOptions`
- `LangfuseRunExperimentResult`
- `LangfuseRunItemResult`
- `LangfuseRunItemError`
- `LangfusePromptClient`
- `LangfusePromptClientOptions`
- `LangfusePromptGetOptions`
- `LangfusePrompt`
- `LangfuseChatMessage`
- `RunEvalAsExperimentOptions`
- `RunEvalAsExperimentResult`
- `createPiiRedactor`
- `DEFAULT_PATTERNS`
- `PiiRedactor`
- `RedactorPattern`
- `LangfuseRedactionOptions`
- `LangfuseRedactionMode`

## Development

```sh
pnpm --filter @anvia/langfuse typecheck
pnpm --filter @anvia/langfuse test
pnpm --filter @anvia/langfuse build
```
