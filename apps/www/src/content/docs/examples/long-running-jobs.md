---
title: Long-running Jobs
description: A pattern for status, retries, and durable results around background runs.
section: examples
sidebar:
  group: Workflow Patterns
  order: 3
---

Long-running jobs need durable status, retry policy, progress, and result storage outside the model run. A job record is the UI contract; runtime events and traces are debugging data.

## Scenario

A research pipeline can take minutes. The UI polls job status while a worker runs source search, synthesis, and final reporting.

## Flow

| State | Meaning |
| --- | --- |
| `queued` | accepted but not started |
| `running` | worker owns the job |
| `waiting_for_input` | human decision or approval is needed |
| `complete` | result is available |
| `failed` | public failure is available |

## Example

```ts
type JobStatus = "queued" | "running" | "waiting_for_input" | "complete" | "failed";

export async function getResearchJobStatus(jobId: string, user: User) {
  const job = await researchJobs.getForUser({
    jobId,
    userId: user.id,
    tenantId: user.tenantId,
  });

  return {
    id: job.id,
    status: job.status satisfies JobStatus,
    progress: job.progress,
    pendingInputId: job.status === "waiting_for_input" ? job.pendingInputId : undefined,
    resultUrl: job.status === "complete" ? job.resultUrl : undefined,
    error: job.status === "failed" ? job.publicError : undefined,
  };
}
```

Retry wrapper:

```ts
export async function runWithRetry(job: ResearchJob) {
  if (job.attempt > 3) {
    await researchJobs.markFailed(job.id, {
      code: "retry_exhausted",
      message: "The report could not be generated after several attempts.",
    });
    return;
  }

  await researchJobs.startAttempt({
    jobId: job.id,
    attempt: job.attempt,
    idempotencyKey: `${job.id}:${job.attempt}`,
  });

  await runResearchWorker(job);
}
```

Worker progress:

```ts
await researchJobs.markRunning(job.id);
await researchJobs.markProgress(job.id, 25);
await collectSources(job);
await researchJobs.markProgress(job.id, 60);
await synthesizeReport(job);
await researchJobs.markProgress(job.id, 90);
await persistReport(job);
await researchJobs.markComplete(job.id, { resultUrl });
```

## Failure Modes

- Users can poll another tenant's job.
- Failed jobs contain raw provider errors.
- Worker retries are not idempotent.
- Progress is not persisted, so reloads lose state.
- Runtime event logs are used as the user-facing job state.

## Next Patterns

- [Pipeline Worker](/docs/examples/pipeline-worker)
- [Human Input](/docs/examples/human-input)
- [Observability Loop](/docs/examples/observability-loop)
