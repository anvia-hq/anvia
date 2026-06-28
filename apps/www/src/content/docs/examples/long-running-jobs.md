---
title: Long-running Jobs
description: A pattern for status, retries, and durable results around background runs.
section: examples
sidebar:
  group: Workflow Patterns
  order: 4
---

Long-running jobs need durable status, retry policy, progress, and result storage outside the model run. BullMQ is a good queue backend for this shape, but the application job record is still the UI contract. Runtime events, traces, and BullMQ internals are debugging and operations data.

## Scenario

A research pipeline can take minutes. The API creates a product job record, enqueues work in BullMQ, and returns immediately. A BullMQ worker runs source search, synthesis, and final reporting while the UI polls the product job record.

## Flow

| State | Meaning |
| --- | --- |
| `queued` | accepted but not started |
| `running` | worker owns the job |
| `waiting_for_input` | human decision or approval is needed |
| `complete` | result is available |
| `failed` | public failure is available |

## Install

```sh
pnpm add bullmq ioredis
```

## Queue Setup

```ts
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

type ResearchJobData = {
  jobId: string;
  tenantId: string;
  requestedBy: string;
  topic: string;
  depth: "standard" | "deep";
};

export const researchQueue = new Queue<ResearchJobData>("research-reports", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800 },
  },
});
```

BullMQ owns queue delivery, retry timing, concurrency, and Redis-backed job lifecycle. The app database owns user-facing status, progress, result URLs, public errors, tenant ownership, and audit fields.

## Enqueue

```ts
export async function enqueueResearchReport(request: Request) {
  const body = await request.json();
  const user = await auth.requireUser();

  const record = await researchJobs.create({
    status: "queued",
    progress: 0,
    tenantId: user.tenantId,
    requestedBy: user.id,
    topic: body.topic,
    depth: body.depth ?? "standard",
  });

  await researchQueue.add(
    "generate-report",
    {
      jobId: record.id,
      tenantId: user.tenantId,
      requestedBy: user.id,
      topic: record.topic,
      depth: record.depth,
    },
    {
      jobId: record.id,
    },
  );

  return Response.json({ jobId: record.id, status: "queued" });
}
```

Use the product job id as the BullMQ `jobId` so duplicate enqueue attempts collapse to the same queued work instead of creating duplicate reports.

## Worker

```ts
import { Worker } from "bullmq";

export const researchWorker = new Worker<ResearchJobData>(
  "research-reports",
  async (bullJob) => {
    const attempt = bullJob.attemptsMade + 1;
    const idempotencyKey = `${bullJob.data.jobId}:${attempt}`;

    await researchJobs.startAttempt({
      jobId: bullJob.data.jobId,
      bullJobId: String(bullJob.id),
      attempt,
      idempotencyKey,
    });

    try {
      await bullJob.updateProgress(10);
      await researchJobs.markRunning(bullJob.data.jobId);

      await bullJob.updateProgress(25);
      await researchJobs.markProgress(bullJob.data.jobId, 25);
      const sources = await collectSources(bullJob.data);

      await bullJob.updateProgress(60);
      await researchJobs.markProgress(bullJob.data.jobId, 60);
      const report = await synthesizeReport({ ...bullJob.data, sources, idempotencyKey });

      await bullJob.updateProgress(90);
      await researchJobs.markProgress(bullJob.data.jobId, 90);
      const result = await persistReport({ ...bullJob.data, report, idempotencyKey });

      await bullJob.updateProgress(100);
      await researchJobs.markComplete(bullJob.data.jobId, {
        resultUrl: result.url,
        traceId: result.traceId,
      });

      return { resultUrl: result.url };
    } catch (error) {
      if (attempt >= (bullJob.opts.attempts ?? 1)) {
        await researchJobs.markFailed(bullJob.data.jobId, publicWorkerError(error));
      }
      throw error;
    }
  },
  { connection, concurrency: 4 },
);
```

The worker throws after recording the public failure state only on the final attempt. BullMQ needs the thrown error to apply retry and failure semantics. App writes should use `idempotencyKey` so retry attempts do not duplicate reports, tickets, or notifications.

## Status Endpoint

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

Do not expose BullMQ job state directly to the browser. Resolve status through `researchJobs.getForUser(...)` so every poll re-checks user and tenant ownership.

## Failure Modes

- Users can poll another tenant's job.
- The app stores status only in BullMQ, so the UI cannot enforce product ownership.
- The product job record is created but enqueue fails; use an outbox or repair job for critical flows.
- Failed jobs contain raw provider errors.
- Worker retries are not idempotent.
- Progress is not persisted, so reloads lose state.
- Runtime event logs are used as the user-facing job state.

## Next Patterns

- [Pipeline Worker](/docs/examples/pipeline-worker)
- [Human Input](/docs/examples/human-input)
- [Observability Loop](/docs/examples/observability-loop)
