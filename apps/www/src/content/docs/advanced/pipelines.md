---
title: Pipelines
description: Compose repeatable prompt, extractor, and agent workflows.
section: advanced
sidebar:
  group: Structured workflows
  order: 42
---

Pipelines make multi-step workflows explicit. Use them when a task is more than one prompt: normalize input, call an agent, extract data, branch into independent checks, run business logic, and return a typed result.

A pipeline is ordinary TypeScript with runtime input validation and a graph that Studio or internal tools can inspect.

## Start With Input

```ts
import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const TicketInput = z.object({
  customer: z.string(),
  subject: z.string(),
  body: z.string().min(1),
});

const normalizeTicket = new PipelineBuilder(TicketInput)
  .step((ticket) => ({
    customer: ticket.customer.trim(),
    subject: ticket.subject.trim(),
    body: ticket.body.trim().replace(/\s+/g, " "),
  }))
  .build();
```

The schema validates each `run(...)` input before any stage executes. TypeScript infers the parsed value for the first step.

## Add Steps

`.step(...)` can be synchronous or asynchronous:

```ts
const pipeline = new PipelineBuilder(TicketInput)
  .step((ticket) => ({
    ...ticket,
    words: ticket.body.split(/\s+/).length,
  }))
  .step(async (ticket) => ({
    ...ticket,
    customerTier: await customers.lookupTier(ticket.customer),
  }))
  .build();
```

Steps should hold deterministic product logic: normalization, database reads, service calls, permission checks, formatting, and final response shaping.

## Prompt An Agent

Use `.prompt(agent)` when a stage needs model reasoning:

```ts
const supportSummary = new PipelineBuilder(TicketInput)
  .step((ticket) =>
    [
      `Customer: ${ticket.customer}`,
      `Subject: ${ticket.subject}`,
      `Body: ${ticket.body}`,
    ].join("\n"),
  )
  .step((text) => `Write a concise internal support summary:\n\n${text}`)
  .prompt(summaryAgent)
  .build();
```

`.prompt(agent)` converts the current value with `String(value)`. Add a formatting step before prompting when the current value is an object.

## Extract Typed Data

Use `.extract(extractor)` when the next stage needs validated fields:

```ts
const triagePipeline = new PipelineBuilder(TicketInput)
  .step((ticket) => `${ticket.subject}\n\n${ticket.body}`)
  .prompt(summaryAgent)
  .extract(ticketExtractor)
  .step((ticket) => ({
    ...ticket,
    route: ticket.priority === "high" ? "incident" : "support",
  }))
  .build();
```

After `.extract(...)`, the next step receives the extractor schema type.

## Compose Pipelines

Use `.use(...)` to reuse another pipeline or any `PipelineOp`:

```ts
const cleanText = new PipelineBuilder(z.string())
  .step((text) => text.trim())
  .step((text) => text.replace(/\s+/g, " "))
  .build();

const classifyNote = new PipelineBuilder(z.string())
  .use(cleanText)
  .step((text) => ({
    text,
    urgent: text.toLowerCase().includes("outage"),
  }))
  .build();
```

This is the right place for reusable deterministic steps. Do not hide product side effects inside a prompt just to keep the pipeline short.

## Name Stages

Add metadata when a pipeline should be inspected or observed:

```ts
const pipeline = new PipelineBuilder(TicketInput, {
  id: "ticket_triage",
  name: "Ticket triage",
  description: "Summarize and route incoming support tickets.",
  metadata: { owner: "support" },
})
  .step(normalizeTicketInput, { name: "Normalize ticket" })
  .prompt(summaryAgent, { name: "Summarize ticket" })
  .extract(ticketExtractor, { name: "Extract triage fields" })
  .build();
```

Stable ids and names make traces, graph inspection, and dashboards easier to read.

## Run And Observe

```ts
const result = await pipeline.run(input, {
  observer: {
    onEvent(event) {
      pipelineEvents.record(event);
    },
  },
});
```

Observers receive stage started, completed, and failed events with the graph node and duration. Use this for workflow-level telemetry. Agent observers still belong on the agents themselves.

## Inspect The Graph

```ts
const graph = pipeline.graph();

await pipelineRegistry.save({
  id: pipeline.id,
  name: pipeline.name,
  graph,
});
```

The graph includes input, step, pipeline, parallel, branch, agent, extractor, and output nodes. It describes the workflow shape, not the run output.

## Production Guidance

Keep routes thin. A route should validate transport input, authenticate, and call a runner. The runner builds or receives a pipeline and maps failures into product responses.

Use background workers when a pipeline has many provider calls, slow media work, retries, or external writes. The pipeline should be deterministic enough that you can test each stage and replay failed inputs.
