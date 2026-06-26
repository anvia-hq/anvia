---
title: Pipeline Worker
description: The pattern for running structured work outside the request path.
section: examples
sidebar:
  group: Workflow Patterns
  order: 2
---

Pipeline workers handle work that should not block the request path: research reports, enrichment jobs, document processing, and batch analysis.

## Scenario

A user asks for a competitive research report. The API validates the request and enqueues a job. A worker runs the pipeline and persists status.

## Example

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

```ts
export async function runResearchWorker(job: ResearchJob) {
  await researchJobs.markRunning(job.id);

  try {
    const result = await researchPipeline.run({
      topic: job.topic,
      tenantId: job.tenantId,
      requestedBy: job.requestedBy,
    });

    await researchJobs.markComplete(job.id, {
      summary: result.summary,
      sources: result.sources,
    });
  } catch (error) {
    await researchJobs.markFailed(job.id, serializeError(error));
    throw error;
  }
}
```

## Failure Modes

- Request path waits for the full pipeline.
- Worker retries create duplicate side effects.
- Job status is inferred from logs instead of stored.
- Pipeline result is not tied back to the requesting user or tenant.

## Next Patterns

- [Long-running Jobs](/docs/examples/long-running-jobs)
- [Research Agent](/docs/examples/research-agent)
