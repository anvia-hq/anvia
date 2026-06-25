// Demonstrates: client.getDataset(name) with pageSize. Creates a
// dataset with several items first so pagination actually exercises.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-experiments-03" });
  try {
    const client = createLangfuseDatasetClient(tracing, { pageSize: 2 });
    const name = `langfuse-ops-get-dataset-${Date.now()}`;
    await client.createDataset({ name });
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `c-${i}`,
      input: { q: `q${i}` },
    }));
    await client.upsertItems(name, items);

    const dataset = await client.getDataset(name);
    console.log(`[experiments:03] fetched ${dataset.items.length} items from ${name}`);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[experiments:03] failed:", error);
  process.exit(1);
});
