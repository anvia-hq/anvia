// Demonstrates: per-item errors. The run function throws for half the
// items; the result.errors array captures them and only successful
// items reach the batched POST.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-experiments-05" });
  try {
    const client = createLangfuseDatasetClient(tracing);
    const datasetName = `langfuse-ops-run-errors-${Date.now()}`;
    await client.createDataset({ name: datasetName });

    const result = await client.runExperiment({
      datasetName,
      runName: `run-errors-${Date.now()}`,
      items: [
        { id: "ok-1", input: { q: "ok" } },
        { id: "bad-1", input: { q: "bad" } },
        { id: "ok-2", input: { q: "ok2" } },
        { id: "bad-2", input: { q: "bad2" } },
      ],
      run: (item) => {
        if (item.id.startsWith("bad-")) {
          throw new Error(`intentional failure for ${item.id}`);
        }
        return { output: `answer-for-${item.id}`, trace: { traceId: `trace-${item.id}` } };
      },
    });

    console.log("[experiments:05] posted:", result.posted, "errors:", result.errors.length);
    for (const err of result.errors) {
      console.log(`  - ${err.itemId}:`, err.error instanceof Error ? err.error.message : err.error);
    }
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[experiments:05] failed:", error);
  process.exit(1);
});
