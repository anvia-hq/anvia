---
"@anvia/langfuse": minor
---

Add Langfuse dataset and experiment-run support.

`createLangfuseDatasetClient(tracing, options)` exposes four
methods:

- `createDataset({ name, description?, metadata? })` PUTs to
  `/api/public/datasets/:name`.
- `getDataset(name)` GETs `/api/public/datasets/:name` with
  pagination driven by `meta.totalPages`.
- `upsertItems(name, items)` POSTs the items array to
  `/api/public/datasets/:name/items`.
- `runExperiment({ datasetName, runName, items?, run })` POSTs
  one batched payload to `/api/public/dataset-run-items` with
  `{ runName, runDescription?, metadata?, datasetItemRuns }`.
  When `items` is not provided the client fetches them from the
  remote dataset first. Per-item failures are collected in
  `errors`; the batch still posts with the successful subset.

`runEvalAsExperiment(evalOptions, experimentOptions)` runs an
`@anvia/core/evals` suite and posts a dataset run alongside the
metric scores, returning both `{ suite, datasetRun }`.

Auth uses the same `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`
env vars and base URL as `langfuse.create()`. Per-request
timeout defaults to 30 seconds (configurable via
`options.timeoutMs`).
