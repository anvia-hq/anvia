# @anvia/lens

Native Anvia Lens tracing and evaluation reporting for Node.js applications.

```sh
pnpm add @anvia/lens @anvia/core
```

```ts
import { AgentBuilder, type CompletionModel } from "@anvia/core";
import { contains, runEvalSuite } from "@anvia/core/evals";
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

const agent = new AgentBuilder("support", model)
  .name("Support Agent")
  .observe(tracing)
  .build();

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
