---
title: Long-running Jobs
description: The pattern for status, retries, and persistence around background runs.
section: examples
sidebar:
  group: Workflow Patterns
  order: 3
---

Long-running jobs need durable status, retry policy, and result storage outside the model run.

## Scenario

A pipeline can take minutes. The UI polls status while a worker runs search, synthesis, and final reporting.

## Example

```ts
type JobStatus = "queued" | "running" | "complete" | "failed";

export async function getResearchJobStatus(jobId: string, user: User) {
  const job = await researchJobs.getForUser({ jobId, userId: user.id });

  return {
    id: job.id,
    status: job.status satisfies JobStatus,
    progress: job.progress,
    resultUrl: job.status === "complete" ? job.resultUrl : undefined,
    error: job.status === "failed" ? job.publicError : undefined,
  };
}
```

```ts
export async function runWithRetry(job: ResearchJob) {
  if (job.attempt > 3) {
    await researchJobs.markFailed(job.id, { code: "retry_exhausted" });
    return;
  }

  await runResearchWorker(job);
}
```

## Failure Modes

- Users can poll another tenant's job.
- Failed jobs contain raw provider errors.
- Worker retries are not idempotent.
- Progress is not persisted, so reloads lose state.

## Next Patterns

- [Pipeline Worker](/docs/examples/pipeline-worker)
- [Observability Loop](/docs/examples/observability-loop)
