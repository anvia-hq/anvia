# @anvia/lens

Native Anvia Lens tracing, evaluation reporting, and dataset access for Node.js applications.

```sh
pnpm add @anvia/lens @anvia/core
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
dataset access still rejects because it requires a configured connection. Partial configuration is
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

## Development

```sh
pnpm --filter @anvia/lens typecheck
pnpm --filter @anvia/lens test
pnpm --filter @anvia/lens build
```
