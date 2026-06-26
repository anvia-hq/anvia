---
title: Parallel and batch work
description: Run branches, batches, and long-running jobs predictably.
section: advanced
sidebar:
  group: Structured workflows
  order: 43
  label: Parallel work
---

Parallel and batch workflows are useful when work is independent. They are risky when hidden dependencies, provider rate limits, or product side effects are unclear.

Core gives you two pipeline-level primitives:

- `.parallel(...)` for named branches from the same current value
- `pipeline.batch(...)` for many inputs with bounded concurrency

Use them deliberately and keep limits close to the runner.

## Parallel Branches

Use `.parallel(...)` when several operations can run from the same input:

```ts
import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const classifyTopic = new PipelineBuilder(z.string())
  .step((text) => ({
    topic: text.toLowerCase().includes("payment") ? "billing" : "operations",
  }))
  .build();

const detectSignals = new PipelineBuilder(z.string())
  .step((text) => ({
    hasOutage: text.toLowerCase().includes("outage"),
    hasEnterpriseCustomer: text.toLowerCase().includes("enterprise"),
  }))
  .build();

const estimatePriority = new PipelineBuilder(z.string())
  .step((text) => ({
    priority: text.toLowerCase().includes("outage") ? "high" : "normal",
  }))
  .build();

const triageSignals = new PipelineBuilder(z.string())
  .parallel({
    classification: classifyTopic,
    signals: detectSignals,
    priority: estimatePriority,
  })
  .step(({ classification, signals, priority }) => ({
    ...classification,
    ...signals,
    ...priority,
  }))
  .build();
```

The branch keys become the output object keys. Use branch names that read well in logs and graph inspection.

## When Not To Parallelize

Do not use parallel branches when one branch needs another branch's result. Keep those stages linear.

Avoid parallel product writes unless the writes are idempotent and your service layer owns conflict handling. It is usually better to parallelize read-only analysis and perform writes in one explicit final step.

## Batch Runs

Use `batch(...)` when the same pipeline should process many inputs:

```ts
const normalizeTicket = new PipelineBuilder(z.string())
  .step((ticket) => ticket.trim())
  .step((ticket) => ticket.replace(/\s+/g, " "))
  .build();

const normalized = await normalizeTicket.batch(
  [
    " checkout   failed ",
    " cannot update card ",
    " password reset issue ",
  ],
  { concurrency: 2 },
);
```

Batch results preserve input order.

## Pick Concurrency By Bottleneck

Start low and tune with provider and service limits:

- CPU-light transforms can usually run with higher concurrency
- provider calls should start around two to five concurrent inputs
- database writes should match transaction and connection limits
- media generation and transcription should usually run in a worker queue

`batch(...)` rejects if any item throws. If you need per-item status, catch errors inside a step and return an explicit result object:

```ts
const safePipeline = new PipelineBuilder(z.string())
  .step(async (input) => {
    try {
      return {
        ok: true as const,
        value: await riskyTransform(input),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: String(error),
      };
    }
  })
  .build();
```

## Long-Running Jobs

For long workflows, do not keep an HTTP request open unless the product explicitly needs live streaming. Prefer:

- route validates and enqueues a job
- worker loads input and runs the pipeline
- pipeline observer records stage events
- worker writes final status and output
- UI polls or subscribes to job status

This keeps provider latency, retries, and downstream service failures out of the user-facing request lifecycle.

## Observability

Attach a pipeline observer for stage-level events:

```ts
const result = await pipeline.run(input, {
  observer: {
    async onEvent(event) {
      await workflowEvents.append({
        jobId,
        type: event.type,
        nodeId: event.node.id,
        nodeLabel: event.node.label,
        durationMs: "durationMs" in event ? event.durationMs : undefined,
      });
    },
  },
});
```

Use agent observers for model calls, tool calls, and traces inside an agent stage. Use pipeline observers for workflow structure.

## Retry Boundary

Retries belong at a boundary you can reason about:

- retry a provider call inside an agent or service adapter when it is safe
- retry an extractor with `.retries(...)` when submitted data is missing or invalid
- retry a whole job only when side effects are idempotent or already guarded
- do not retry a whole batch blindly after partial writes

If the workflow writes to product state, add idempotency keys or transactional service methods before adding automatic retries.
