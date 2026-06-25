// Demonstrates: client.runExperiment({ datasetName, runName, run }).
// We provide items directly to skip the getDataset round trip.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-experiments-04" });
  try {
    const client = createLangfuseDatasetClient(tracing);
    const datasetName = `langfuse-ops-run-experiment-${Date.now()}`;
    await client.createDataset({ name: datasetName });

    const result = await client.runExperiment({
      datasetName,
      runName: `run-${Date.now()}`,
      items: [
        { id: "c-1", input: { q: "hi" } },
        { id: "c-2", input: { q: "bye" } },
      ],
      run: (item) => ({
        output: `answer-for-${item.id}`,
        trace: { traceId: `trace-${item.id}` },
      }),
    });
    console.log("[experiments:04] posted:", result.posted, "errors:", result.errors.length);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[experiments:04] failed:", error);
  process.exit(1);
});
