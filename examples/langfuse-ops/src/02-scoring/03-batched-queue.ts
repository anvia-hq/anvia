// Demonstrates: the in-memory score queue. scoreBatchSize triggers an
// immediate flush, scoreFlushIntervalMs debounces, scoreMaxRetries
// retries 429/5xx. flushScores() drains whatever is left.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({
    name: "langfuse-ops-scoring-03",
    scoreBatchSize: 5,
    scoreFlushIntervalMs: 100,
    scoreMaxRetries: 3,
  });
  try {
    const fakeTraceId = "00000000-0000-0000-0000-000000000003";
    for (let i = 0; i < 12; i += 1) {
      await tracing.score({
        traceId: fakeTraceId,
        name: `latency-${i}`,
        value: 100 + i,
      });
    }
    console.log("[scoring:03] queued 12 scores, depth =", tracing.scoreQueueDepth());
    await tracing.flushScores();
    console.log("[scoring:03] after flushScores, depth =", tracing.scoreQueueDepth());
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[scoring:03] failed:", error);
  process.exit(1);
});
