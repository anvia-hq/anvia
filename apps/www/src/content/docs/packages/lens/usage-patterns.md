---
title: "@anvia/lens: Usage Patterns"
description: "Safe capture, evaluation reporting, and lifecycle patterns."
section: packages
sidebar:
  group: "@anvia/lens"
  order: 3
  label: "Usage Patterns"
---
## Safe and full capture

Safe capture records operational metadata without input and output bodies. Opt into full capture
only when the application is allowed to export payloads:

```ts
const tracing = lens.create({
  captureMode: "full",
  captureMaxBytes: 128 * 1024,
  redactInputs: true,
  redactOutputs: true,
});
```

The built-in redactor masks common email, credential, bearer token, and payment-card patterns.

## Report evaluations

```ts
import { runEvalSuite } from "@anvia/core/evals";
import { createLensEvalReporter } from "@anvia/lens";

await runEvalSuite({
  name: "support-regression",
  run: {
    datasetName: "support-cases",
    datasetVersion: "2026-08-07",
    metadata: { commitSha: process.env.GITHUB_SHA },
  },
  cases,
  target,
  metrics,
  reporters: [
    createLensEvalReporter(tracing, {
      includePayloads: true,
      includeMetadata: true,
    }),
  ],
});
```

Lens receives run start and finish events plus suite, case, metric, outcome, and trace correlation.
Use the returned `result.run.id` to link directly to a run. Case payloads and metadata are omitted
by default; enable `includePayloads` and `includeMetadata` only when those values are approved for
export. Payload capture uses the tracing instance's redaction transforms and capture-size limit.

## Run a managed dataset

```ts
import { runEvalSuite } from "@anvia/core/evals";
import { createLensDatasetClient, createLensEvalReporter } from "@anvia/lens";

const datasets = createLensDatasetClient(tracing);
const dataset = await datasets.getDataset("support-cases", { version: "v2" });

await runEvalSuite({
  name: "support-regression",
  run: { datasetName: dataset.name, datasetVersion: dataset.version },
  cases: dataset.items,
  target,
  metrics,
  reporters: [createLensEvalReporter(tracing)],
});
```

The same project public and secret keys used for telemetry authenticate dataset reads. Only
published versions are available. Omit `version` to fetch the latest published version.
