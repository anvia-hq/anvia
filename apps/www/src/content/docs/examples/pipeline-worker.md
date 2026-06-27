---
title: Pipeline Worker
description: A pattern for running structured work outside the request path.
section: examples
sidebar:
  group: Workflow Patterns
  order: 2
---

Pipeline workers handle work that should not block the request path: research reports, enrichment jobs, document processing, batch analysis, and ingestion refreshes. The request creates a job; the worker runs the pipeline and persists status.

## Scenario

A user asks for a competitive research report. The API validates the request and enqueues a job. A worker searches approved sources, asks an agent to synthesize findings, and stores the report.

## Flow

| Step | Boundary |
| --- | --- |
| validate and enqueue | API route |
| run typed pipeline | worker |
| emit progress | job store |
| persist result | product database |
| retry safely | queue/job policy |

## Example

```ts
import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const ResearchInput = z.object({
  jobId: z.string(),
  tenantId: z.string(),
  requestedBy: z.string(),
  topic: z.string().min(1),
  depth: z.enum(["standard", "deep"]).default("standard"),
});

export function createResearchPipeline(scope: ResearchPipelineScope) {
  return new PipelineBuilder(ResearchInput, {
    name: "research-report",
  })
    .step(async (input) => {
      await scope.jobs.markProgress(input.jobId, 20);
      const sources = await scope.sources.searchApproved({
        tenantId: input.tenantId,
        topic: input.topic,
      });
      return { ...input, sources };
    }, { name: "collect-sources" })
    .step(async (input) => {
      await scope.jobs.markProgress(input.jobId, 60);
      const response = await scope.researchAgent
        .prompt(renderResearchPrompt(input))
        .withTrace({
          name: "research-report",
          userId: input.requestedBy,
          metadata: {
            tenantId: input.tenantId,
            jobId: input.jobId,
            sourceIds: input.sources.map((source) => source.id),
          },
        })
        .send();
      return { ...input, output: response.output, traceId: response.trace?.traceId };
    }, { name: "synthesize" })
    .step(async (input) => {
      const report = await scope.reports.create({
        tenantId: input.tenantId,
        requestedBy: input.requestedBy,
        topic: input.topic,
        output: input.output,
        sourceIds: input.sources.map((source) => source.id),
        traceId: input.traceId,
      });
      return { reportId: report.id };
    }, { name: "persist-report" })
    .build();
}
```

API route:

```ts
export async function enqueueResearchReport(request: Request) {
  const body = await request.json();
  const user = await auth.requireUser();

  const job = await researchJobs.enqueue({
    requestedBy: user.id,
    tenantId: user.tenantId,
    topic: body.topic,
    depth: body.depth ?? "standard",
  });

  return Response.json({ jobId: job.id, status: "queued" });
}
```

Worker:

```ts
export async function runResearchWorker(job: ResearchJob) {
  await researchJobs.markRunning(job.id);

  try {
    const pipeline = createResearchPipeline(workerScope);
    const result = await pipeline.run({
      jobId: job.id,
      topic: job.topic,
      depth: job.depth,
      tenantId: job.tenantId,
      requestedBy: job.requestedBy,
    });

    await researchJobs.markComplete(job.id, result);
  } catch (error) {
    await researchJobs.markFailed(job.id, publicWorkerError(error));
    throw error;
  }
}
```

## Failure Modes

- Request path waits for the full pipeline.
- Worker retries create duplicate side effects.
- Job status is inferred from logs instead of stored.
- Pipeline result is not tied back to the requesting user or tenant.
- Source ids and trace ids are not saved with the report.

## Next Patterns

- [Long-running Jobs](/docs/examples/long-running-jobs)
- [Research Agent](/docs/examples/research-agent)
- [Eval Loop](/docs/examples/eval-loop)
