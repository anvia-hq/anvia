# @anvia/lens

Native Anvia Lens tracing, evaluation reporting, dataset access, and versioned prompts for Node.js applications.

```sh
pnpm add @anvia/lens @anvia/core zod
```

## Client lifecycle

`LensClient` owns isolated OpenTelemetry trace and log providers. It never registers global
providers or captures unrelated application telemetry. Construction and accessor calls perform no
I/O; exporters initialize lazily.

```ts
import { Agent, type CompletionModel } from "@anvia/core";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { Pipeline } from "@anvia/core/pipeline";
import { LensClient } from "@anvia/lens";
import { z } from "zod";

declare const model: CompletionModel;

await using lens = new LensClient({
  baseUrl: process.env.ANVIA_LENS_BASE_URL,
  publicKey: process.env.ANVIA_LENS_PUBLIC_KEY,
  secretKey: process.env.ANVIA_LENS_SECRET_KEY,
  serviceName: "support-agent",
  environment: "production",
  release: "2026.08.1",
});

const agent = new Agent({
  id: "support",
  model,
  observability: {
    observers: { lens: lens.observer() },
    primaryTrace: "lens",
  },
});

const pipeline = new Pipeline({
  id: "support-flow",
  inputSchema: z.string(),
  observability: {
    observers: { lens: lens.pipelineObserver() },
    primaryTrace: "lens",
  },
}).agent({
  id: "answer",
  agent,
  suspension: "reject",
  request: ({ input }) => ({ prompt: input }),
});

const pipelineResult = await pipeline.run({
  input: "How long are refunds available?",
  trace: { sessionId: "support-session" },
});

const suite = await runEvalSuite({
  name: "support-regression",
  cases: [{ id: "refund", input: "Request a refund", expected: "refund" }],
  target: agentEvalTarget<string>({
    agent,
    request: ({ input }) => ({ prompt: input }),
  }),
  metrics: [contains()],
  reporters: [lens.evalReporter()],
});
```

`await using` disposes the client at scope exit, flushing and shutting down both owned providers.
Use `flush()` only for an explicit delivery checkpoint. `close()` is idempotent and terminal.

Process signals do not unwind an `await using` scope. A CLI should handle `SIGINT` and `SIGTERM`,
abort and await its active Agent run, and only then await `lens.close()`. This order lets Core finish
the root observation as `cancelled` before Lens flushes it.

Set `optional: true` to obtain a disabled client when all Lens connection environment variables
are absent. `lens.enabled` reports the state. The disabled observer and reporter are safe no-ops;
dataset and prompt access still reject because they require a configured connection. Partial configuration is
always an error.

## Capture and evaluation policy

Safe capture omits prompt and response bodies. Configure observer and reporter payloads
independently:

```ts
const observer = lens.observer({
  captureMode: "safe",
  redactInputs: true,
  redactOutputs: true,
  redaction: { replacement: "[REDACTED]" },
});

const pipelineObserver = lens.pipelineObserver({
  captureMode: "safe",
  redactInputs: true,
  redactOutputs: true,
});

const reporter = lens.evalReporter({
  includePayloads: false,
  includeMetadata: false,
  onMissingTrace: "warn",
});
```

Lens eval reporters accept traces from the `"lens"` Agent observer registration by default. Set
`traceObserver` to the Agent registration name when it differs.

## Runtime scores and end-user feedback

`score()` records a trace-correlated evaluation result through Lens's existing OTLP logs exporter:

```ts
await lens.score({
  id: feedbackId,
  traceId,
  observationId,
  responseId,
  name: "user-feedback",
  value: liked ? 1 : 0,
  dataType: "BOOLEAN",
  source: "end_user",
  comment,
  metadata: { channel: "thumbs", userIdHash },
});
```

Use a stable `id` when a later vote should replace an earlier one. Omit it when each score should be
stored as a separate event. `score()` queues the log in the owned provider; `flush()` or client
disposal completes delivery. Comments are limited to 2,000 characters; validate metadata before
recording it and avoid raw personal identifiers.

## Managed datasets

```ts
const datasets = lens.datasetClient({ pageSize: 50 });
const dataset = await datasets.getDataset<string, string>({
  name: "support-cases",
  version: "v2",
});
```

The client paginates automatically and selects the latest published version when `version` is
omitted. Draft and archived versions are not exposed by the public API.

Configuration can also come from `ANVIA_LENS_BASE_URL`, `ANVIA_LENS_PUBLIC_KEY`,
`ANVIA_LENS_SECRET_KEY`, `ANVIA_LENS_SERVICE_NAME`, `ANVIA_LENS_ENVIRONMENT`, and
`ANVIA_LENS_RELEASE`.

## Versioned prompts

```ts
const prompts = lens.promptClient({ cacheTtlMs: 60_000, timeoutMs: 5_000 });
const prompt = await prompts.getPrompt({ name: "support/answer" });

if (prompt.type === "text") {
  const result = await agent.generate({
    prompt: prompt.compile({ question: "How do refunds work?" }),
    trace: { promptRef: prompt.ref },
  });
}

const pinned = await prompts.getPrompt({ name: "support/answer", version: 2 });
const staging = await prompts.getPrompt({ name: "support/answer", label: "staging" });
```

Omitting the selector resolves `production`, never the newest version. Specify a label **or** a
positive safe integer version, not both. Committing a version does not deploy it: move the label
in Lens to deploy or roll back. Runtime credentials retrieve prompts but cannot mutate them.

Resolved snapshots are deeply immutable and expose `ref`, `config`, `labels`, `selector`, and
`variables`. Compilation is synchronous: `{{question}}` substitutes a named string, surrounding
whitespace is tolerated, and `\{{question}}` produces literal `{{question}}`. Missing or non-string
values throw `LensPromptCompilationError`; extra variables are ignored. Substitutions are not
recursive. Config is returned unchanged, not interpolated. Chat compilation returns a fresh array
of registry messages with roles and names preserved; these are not cast to Core completion messages.

Each prompt client owns a bounded cache. The default TTL is 60 seconds, including pinned versions;
expired entries refresh before returning, without stale fallback. Identical concurrent requests
share retrieval. `cache: "reload"` fetches and replaces a snapshot; `cache: "no-store"` bypasses cache
reads and writes. `prompts.clearCache()` invalidates cached snapshots. Retrieval accepts an optional
`signal`; one caller aborting does not cancel other callers sharing retrieval. Failed responses
are not cached. `LensPromptError` exposes `code` and, for HTTP errors, `status`.

Fetching or compiling never sets a global current prompt. Pass `trace.promptRef` explicitly for
Agent runs or pipeline roots, and `run: { promptRef: prompt.ref }` to `runEvalSuite` for evaluation
identity. Pipeline attribution does not stamp unrelated child agents. Per-generation middleware can
override `promptRef` or clear it with `null`; see Core's middleware documentation. Safe capture retains
prompt identity without newly capturing template bodies or compilation variables.

## Development

```sh
pnpm --filter @anvia/lens typecheck
pnpm --filter @anvia/lens test
pnpm --filter @anvia/lens build
```
