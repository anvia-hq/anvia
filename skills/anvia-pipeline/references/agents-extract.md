# Agent and Extractor Stages

## Agent stages

Embed one bounded agent where a step needs judgment. The stage maps pipeline
input to an agent request explicitly, and `suspension` is required:

```ts
const executiveUpdate = new Pipeline({ id: "executive-update", inputSchema: z.array(z.string()) })
  .step({
    id: "format-notes",
    run: ({ input }) => input.map((note) => `- ${note}`).join("\n"),
  })
  .agent({
    id: "analyze",
    agent: analyst,
    suspension: "reject",
    request: ({ input }) => ({
      prompt: `Prepare an executive update from these notes:\n\n${input}`,
    }),
  });
```

- Keep the agent's instructions narrow (one task, facts-only, visible final
  text) — the pipeline already handles orchestration, so the agent must not
  coordinate.
- Prefer approval-free agents inside pipelines. A tool approval inside an agent
  stage suspends the run (`PipelineAgentSuspensionError`); if you need
  approvals, surface them at the pipeline boundary instead of burying them
  mid-flow.

## Extractor stages

Extractor stages turn unstructured text into schema-validated objects. Reach
for them when a step's job is "pull fields out of this text" rather than
open-ended judgment; the schema is the contract downstream steps program
against:

```ts
const ticketed = pipeline.extract({
  id: "extract-ticket",
  text: ({ input }) => input.body,
  model,
  outputSchema: z.object({ title: z.string(), priority: z.enum(["low", "high"]) }),
  instructions: "Extract the support ticket fields.",
});
```

`text` maps the previous stage's output to the source text; `model`,
`instructions`, `retries`, `temperature`, `maxTokens`, and `providerOptions`
behave like the single extraction call. The cookbook's extractor-pipeline
example shows a full flow.

## Observing runs

`run` / `runBatch` accept an `observer` (`stage_started` / `stage_completed` /
`stage_failed`), plus `abortSignal`, `metadata`, `runId`, and
`failOnObserverError`; `graph()` prints the stage graph. Pipelines also carry
`observability` options from construction, and Studio replays run history stage
by stage (see the `anvia-studio` skill). When a pipeline misbehaves, replay the
failing run in Studio before changing stages — most pipeline bugs are wrong
intermediate outputs, visible at the stage boundary.
