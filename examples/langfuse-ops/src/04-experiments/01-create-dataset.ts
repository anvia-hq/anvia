// Demonstrates: createLangfuseDatasetClient().createDataset({...}).
// Uses a unique name per run so the script is idempotent.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-experiments-01" });
  try {
    const client = createLangfuseDatasetClient(tracing);
    const name = `langfuse-ops-create-dataset-${Date.now()}`;
    const created = await client.createDataset({
      name,
      description: "Created by langfuse-ops experiments:01",
      metadata: { source: "langfuse-ops", script: "01-create-dataset" },
    });
    console.log("[experiments:01] created dataset:", created.name);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[experiments:01] failed:", error);
  process.exit(1);
});
