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
  cases,
  target,
  metrics,
  reporters: [createLensEvalReporter(tracing)],
});
```

Evaluation events include suite, case, metric, outcome, and trace correlation when the target
returns a trace reference. Case, metric, and outcome metadata are omitted by default; set
`includeMetadata: true` only when that metadata is approved for export.
