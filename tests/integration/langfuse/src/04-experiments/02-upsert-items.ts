// Demonstrates: client.upsertItems({ name, items }). Creates a dataset
// first (idempotently) and pushes a small set of items.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-experiments-02" });
  const client = tracing.datasetClient();
  const name = `langfuse-ops-upsert-items-${Date.now()}`;
  await client.createDataset({ name, description: "For upsertItems demo" });
  await client.upsertItems({
    name,
    items: [
      { id: "c-1", input: { q: "hi" }, expected: "hello" },
      { id: "c-2", input: { q: "bye" }, expected: "goodbye" },
    ],
  });
  console.log(`[experiments:02] upserted 2 items into ${name}`);
}

main().catch((error: unknown) => {
  console.error("[experiments:02] failed:", error);
  process.exit(1);
});
