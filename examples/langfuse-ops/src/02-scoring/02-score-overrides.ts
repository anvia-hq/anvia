// Demonstrates: per-score configId, environment override, timestamp
// (Date and ISO), comment, and metadata.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-scoring-02" });
  try {
    const fakeTraceId = "00000000-0000-0000-0000-000000000002";

    await tracing.score({
      traceId: fakeTraceId,
      name: "quality",
      value: 0.87,
      dataType: "NUMERIC",
      configId: "ops-quality-config",
      environment: "staging",
      timestamp: new Date(),
      comment: "Heuristic quality score from scoring:02 demo",
      metadata: { source: "demo", scorer: "heuristic-v1" },
    });

    await tracing.score({
      traceId: fakeTraceId,
      name: "quality-iso",
      value: 0.91,
      timestamp: "2026-06-24T12:00:00.000Z",
      configId: "ops-quality-config",
    });

    // scoreConfigId is an alias for configId
    await tracing.score({
      traceId: fakeTraceId,
      name: "quality-alias",
      value: 0.7,
      scoreConfigId: "ops-quality-config",
    });

    console.log("[scoring:02] sent 3 scores with overrides + configId aliases");
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[scoring:02] failed:", error);
  process.exit(1);
});
