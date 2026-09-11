---
name: anvia-pipeline
description: Build deterministic multi-step work with Anvia Pipelines — steps, composition, parallel branches, batch runs, agent and extractor stages.
---

# Anvia Pipeline Skill

Use this skill when the work is a fixed sequence of steps, not a model-driven
loop: transforms, parsing, scoring, fan-out/fan-in, batch runs, or pipelines
with one bounded agent or extractor stage inside.

## Pipeline vs agent

- Reach for `Pipeline` when you can name the steps upfront. Reach for `Agent`
  (see the `anvia-agent` skill) when the model must decide what to do next.
- The common failure is an agent with rising `maxTurns` doing a fixed sequence
  — rewrite that as a pipeline with one `.agent()` stage instead.

## Process

1. Model the flow as stages (`references/steps-compose.md`) — step, compose,
   parallel, batch.
2. Add model stages only where judgment is needed (`references/agents-extract.md`).
3. Run `scripts/check-pipeline.sh` from the app root before claiming done.

## Minimal slice

```ts
import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const normalizeIncident = new Pipeline({ id: "normalize-incident", inputSchema: z.string() })
  .step({ id: "trim", run: ({ input }) => input.trim() })
  .step({ id: "collapse-whitespace", run: ({ input }) => input.replace(/\s+/g, " ") })
  .step({
    id: "summarize",
    run: ({ input }) => ({
      normalized: input,
      wordCount: input.split(" ").length,
      priority: input.toLowerCase().includes("outage") ? "high" : "normal",
    }),
  });

const result = await normalizeIncident.run({ input: "  Checkout outage reported.  " });
console.log(result.output);
```

## Output

Keep stages small, named, and typed — each stage's output is the next stage's
input. Point to the relevant reference file instead of pasting its contents
into chat.
