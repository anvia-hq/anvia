// Demonstrates: client.datasetClient().createDataset({...}).
// Uses a unique name per run so the script is idempotent.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-experiments-01" });
  const client = tracing.datasetClient();
  const name = `langfuse-ops-create-dataset-${Date.now()}`;
  const created = await client.createDataset({
    name,
    description: "Created by langfuse-ops experiments:01",
    metadata: { source: "langfuse-ops", script: "01-create-dataset" },
  });
  console.log("[experiments:01] created dataset:", created.name);
}

main().catch((error: unknown) => {
  console.error("[experiments:01] failed:", error);
  process.exit(1);
});
