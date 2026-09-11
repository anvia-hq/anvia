# Steps and Composition

Pipelines come from `@anvia/core/pipeline`. The constructor takes an `id` and a
zod `inputSchema` — inputs are parsed at the boundary, and a non-zod schema
throws. Every stage takes an `id`:

```ts
const ticketSummary = new Pipeline({ id: "ticket-summary", inputSchema: z.string() })
  .compose({ id: "parse", pipeline: parseTicket })
  .compose({ id: "score", pipeline: scoreTicket });

const { output: summary } = await ticketSummary.run({ input: rawTicket });
```

## Stage kinds

- `.step({ id, run })` — a pure function of `{ input }`. `run` may be async.
  Prefer many small named steps over one big closure.
- `.compose({ id, pipeline })` — nest a whole pipeline as a stage. Build
  parse/score/format sub-pipelines independently, then compose them.
- `.parallel({ id, branches })` — fan out over named sub-pipelines, then merge:

```ts
const triage = new Pipeline({ id: "triage", inputSchema: z.string() })
  .parallel({
    id: "signals",
    branches: { classification: classifyText, signals: extractSignals, priority: estimatePriority },
  })
  .step({
    id: "merge",
    run: ({ input: { classification, signals, priority } }) => ({
      ...classification,
      ...signals,
      ...priority,
    }),
  });
```

Branch outputs arrive keyed by branch name — destructure them in the merge step.
Keep branches independent; a branch that needs another branch's output belongs
downstream, not in the same fan-out.

## Batch runs

```ts
const batch = await normalizeIncident.runBatch({
  inputs: ["Payment latency for EU customers.", "Search outage for the admin dashboard."],
  concurrency: 2,
});
```

`runBatch` maps the same pipeline over inputs with bounded concurrency. Use it
instead of hand-rolled `Promise.all` loops — backpressure and error
aggregation come free.

## Rules

- Every pipeline and stage needs an `id`. Ids show up in traces, logs, and
  Studio replay — `step-1`, `step-2` waste that surface.
- Type the seams: `inputSchema` on the pipeline, object outputs from steps. An
  untyped middle step turns every downstream stage into guesswork.
- Deterministic stages first, model stages last and few (see
  `references/agents-extract.md`).
