// Demonstrates: client.upsertItems(name, items[]). Creates a dataset
// first (idempotently) and pushes a small set of items.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-experiments-02" });
  try {
    const client = createLangfuseDatasetClient(tracing);
    const name = `langfuse-ops-upsert-items-${Date.now()}`;
    await client.createDataset({ name, description: "For upsertItems demo" });
    await client.upsertItems(name, [
      { id: "c-1", input: { q: "hi" }, expected: "hello" },
      { id: "c-2", input: { q: "bye" }, expected: "goodbye" },
    ]);
    console.log(`[experiments:02] upserted 2 items into ${name}`);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[experiments:02] failed:", error);
  process.exit(1);
});
