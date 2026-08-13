# @anvia/lens

Native Anvia Lens tracing and evaluation reporting for Node.js applications.

```sh
pnpm add @anvia/lens @anvia/core
```

```ts
import { Agent, type CompletionModel } from "@anvia/core";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLensEvalReporter, lens } from "@anvia/lens";

declare const model: CompletionModel; // Supplied by your provider adapter.

const tracing = lens.create({
  baseUrl: process.env.ANVIA_LENS_BASE_URL,
  publicKey: process.env.ANVIA_LENS_PUBLIC_KEY,
  secretKey: process.env.ANVIA_LENS_SECRET_KEY,
  serviceName: "support-agent",
  environment: "production",
  release: "2026.08.1",
});

const agent = new Agent({
  id: "support",
  model: model,
  name: "Support Agent",
  observers: [tracing],
});

const reporter = createLensEvalReporter(tracing);

const suite = await runEvalSuite({
  name: "support-regression",
  run: { datasetName: "support-cases", datasetVersion: "v2" },
  cases: [{ id: "refund", input: "Request a refund", expected: "refund" }],
  target: async (input) => input,
  metrics: [contains()],
  reporters: [reporter],
});

console.log(suite.run.id);
```

`lens.create()` owns isolated OpenTelemetry trace and log providers. It does not register global
providers or capture unrelated application telemetry. Call `flush()` in short-lived processes and
`shutdown()` before exit.

For short-lived eval scripts, bundle optional environment setup, the observer, reporter, and
flushing:

```ts
const evals = lens.evals({
  optional: true,
  serviceName: "support-evals",
  includePayloads: true,
});

const agent = new Agent({
  id: "support",
  model: model,
  observers: [evals.observer],
});
await runEvalSuite({
  ...suiteOptions,
  target: agentEvalTarget(agent),
  reporters: [evals.reporter],
});
```

When all Lens connection environment variables are absent, `optional: true` returns no-op tracing
that is safe to register directly. Partial configuration remains an error. `lens.evals()` flushes
on run end by default; the lower-level `createLensEvalReporter` enables the same behavior with
`flushOnRunEnd: true`.

Safe capture omits traced prompt and response bodies. The Lens eval reporter also omits evaluation
case payloads and metadata by default. Enable them independently when approved for export:

```ts
const reporter = createLensEvalReporter(tracing, {
  includePayloads: true,
  includeMetadata: true,
});
```

Evaluation payloads include the case input, expected value, contexts, and target output. They use
the tracing instance's redaction transforms and `captureMaxBytes` limit.

## Managed datasets

Fetch an immutable dataset version managed in Lens and pass its items directly to the core eval
runner:

```ts
import { runEvalSuite } from "@anvia/core/evals";
import { createLensDatasetClient } from "@anvia/lens";

const datasets = createLensDatasetClient(tracing);
const dataset = await datasets.getDataset<string, string>("support-cases", { version: "v2" });

await runEvalSuite({
  name: "support-regression",
  run: { datasetName: dataset.name, datasetVersion: dataset.version },
  cases: dataset.items,
  target,
  metrics,
  reporters: [reporter],
});
```

The client reuses the tracing instance's base URL and project credentials, automatically paginates,
and selects the latest published version when `version` is omitted. Draft and archived versions are
not readable through the public API.

Configuration can also be provided through `ANVIA_LENS_BASE_URL`, `ANVIA_LENS_PUBLIC_KEY`,
`ANVIA_LENS_SECRET_KEY`, `ANVIA_LENS_SERVICE_NAME`, `ANVIA_LENS_ENVIRONMENT`, and
`ANVIA_LENS_RELEASE`.

## Docker integration test

With the Lens repository checked out beside this repository and its credentials configured in the
root `.env`, run:

```sh
pnpm test:lens-integration
```

The test starts the existing Compose services, runs a provider-free native agent evaluation, and
checks trace ingestion, evaluation correlation, and safe payload capture in ClickHouse. The full
variant rebuilds Compose and verifies persistence across a ClickHouse restart:

```sh
pnpm test:lens-integration:full
```

Set `ANVIA_LENS_REPO` when the Lens checkout is not located at `../lens`.
