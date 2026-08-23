# @anvia/langfuse

Langfuse tracing, evaluation reporting, scoring, prompt, and dataset integration for Anvia.

## Installation

```sh
pnpm add @anvia/langfuse @anvia/core
```

## Client lifecycle and Agent tracing

`LangfuseClient` owns its OpenTelemetry SDK, exporter, and optional score queue. Construction and
accessor calls do not perform I/O; resources are initialized lazily on first use.

```ts
import { Agent, type CompletionModel } from "@anvia/core";
import { LangfuseClient } from "@anvia/langfuse";

declare const model: CompletionModel;

await using langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
  serviceName: "support-service",
  environment: "production",
  release: "2026.08.1",
});

const agent = new Agent({
  id: "support",
  model,
  observability: {
    observers: {
      langfuse: langfuse.observer(),
    },
    primaryTrace: "langfuse",
    errorPolicy: "ignore",
  },
});

const result = await agent.generate({
  prompt: "Summarize this support request.",
  trace: {
    name: "support-summary",
    userId: "user_123",
    sessionId: "session_456",
    metadata: { tenantId: "acme" },
    tags: ["support"],
  },
});

if (result.type === "response") {
  console.log(result.output);
  console.log(result.trace); // { observer: "langfuse", traceId, observationId }
}
```

`await using` calls `langfuse[Symbol.asyncDispose]()` at scope exit. Disposal drains queued scores,
flushes pending traces, and shuts down owned resources. Use `flush()` only when a long-running
process needs an explicit mid-lifecycle delivery checkpoint. `close()` is idempotent and terminal.
Each client owns an isolated, unregistered tracer provider, so multiple Langfuse clients and an
application-wide OpenTelemetry provider can coexist without replacing one another.

Observer capture policy is registration-specific:

```ts
const observer = langfuse.observer({
  captureMode: "safe",
  captureMaxBytes: 64_000,
  redactInputs: true,
  redactOutputs: "deep",
  redaction: { replacement: "[REDACTED]" },
});
```

An observer does not own resources and has no `flush()` or `close()` method. A client can create
multiple observers with different capture policies.

## Evaluation reporting

```ts
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";

const suite = await runEvalSuite({
  name: "support-regression",
  cases: [{ id: "refund", input: "What is the refund window?", expected: "30 days" }],
  target: agentEvalTarget<string>({
    agent,
    request: ({ input }) => ({ prompt: input }),
  }),
  metrics: [contains()],
  reporters: [
    langfuse.evalReporter({
      onMissingTrace: "warn",
      includeMessages: false,
    }),
  ],
  reporterErrorPolicy: "collect",
});
```

Reporter failures are collected by default. Use `reporterErrorPolicy: "throw"` when reporter
delivery is operationally required; every reporter is still attempted before the aggregate error
is thrown. The reporter accepts traces produced by the `"langfuse"` observer by default. When that
observer has a different Agent registration name, set `traceObserver` to the same name. This
prevents a score from being posted against another backend's primary trace.

Run an eval suite and publish its cases as one Langfuse dataset experiment:

```ts
const result = await langfuse.runEvalExperiment({
  suite: {
    name: "support-regression",
    cases,
    target,
    metrics,
  },
  experiment: {
    datasetName: "support-cases",
    runName: "rc2",
    publishScores: true,
  },
});
```

## Scores

Scores are sent directly unless batching is configured:

```ts
await using langfuse = new LangfuseClient({
  publicKey,
  secretKey,
  scores: {
    batchSize: 20,
    flushIntervalMs: 250,
    retries: { maxAttempts: 3 },
  },
});

await langfuse.score({
  traceId,
  observationId,
  name: "quality",
  value: 0.95,
  dataType: "NUMERIC",
});
```

`maxAttempts` includes the initial attempt. Client disposal drains the queue; callers do not need
to flush it manually.

## Datasets

```ts
const datasets = langfuse.datasetClient({ pageSize: 50 });

await datasets.createDataset({ name: "support-cases" });
await datasets.upsertItems({
  name: "support-cases",
  items: [{ id: "refund", input: "Refund window?", expected: "30 days" }],
});

const dataset = await datasets.getDataset<string, string>({
  name: "support-cases",
});
```

## Prompts

```ts
const prompts = langfuse.promptClient({ cacheTtlMs: 60_000 });

const text = await prompts.getPromptText({
  name: "support.system",
  label: "production",
});

const chat = await prompts.getPromptChat({ name: "support.chat" });
prompts.refresh();
```

## Development

```sh
pnpm --filter @anvia/langfuse typecheck
pnpm --filter @anvia/langfuse test
pnpm --filter @anvia/langfuse build
```
