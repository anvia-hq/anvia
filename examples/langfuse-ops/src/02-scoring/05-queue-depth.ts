// Demonstrates: monitoring scoreQueueDepth() while scores are enqueued.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({
    name: "langfuse-ops-scoring-05",
    scoreBatchSize: 100, // large batch so the queue actually fills
    scoreFlushIntervalMs: 5_000, // long debounce
  });
  try {
    const fakeTraceId = "00000000-0000-0000-0000-000000000005";
    for (let i = 0; i < 10; i += 1) {
      await tracing.score({
        traceId: fakeTraceId,
        name: `latency-${i}`,
        value: 100 + i,
      });
      console.log(`[scoring:05] after enqueue ${i + 1}, depth =`, tracing.scoreQueueDepth());
    }
    await tracing.flushScores();
    console.log("[scoring:05] final depth =", tracing.scoreQueueDepth());
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[scoring:05] failed:", error);
  process.exit(1);
});
