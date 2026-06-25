// Demonstrates: tracing.score() with all three data types (NUMERIC,
// CATEGORICAL, BOOLEAN). Uses a fake traceId so the demo runs without
// needing a real prior run; in practice, wire the score to a real trace.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-scoring-01" });
  try {
    const fakeTraceId = "00000000-0000-0000-0000-000000000001";

    await tracing.score({
      traceId: fakeTraceId,
      name: "latency-ms",
      value: 412,
      dataType: "NUMERIC",
    });
    await tracing.score({
      traceId: fakeTraceId,
      name: "verdict",
      value: "pass",
      dataType: "CATEGORICAL",
    });
    await tracing.score({
      traceId: fakeTraceId,
      name: "grounded",
      value: 1,
      dataType: "BOOLEAN",
    });

    console.log("[scoring:01] sent 3 scores (NUMERIC, CATEGORICAL, BOOLEAN)");
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[scoring:01] failed:", error);
  process.exit(1);
});
