// Demonstrates: cacheTtlMs, the refresh: true flag, and client.refresh().

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-prompts-04" });
  try {
    const client = createLangfusePromptClient(tracing, { cacheTtlMs: 60_000 });
    const name = optionalEnv("LANGFUSE_TEXT_PROMPT_NAME") ?? "support-system-text";

    const first = await client.getPrompt(name);
    const second = await client.getPrompt(name); // cache hit
    const refreshed = await client.getPrompt(name, { refresh: true }); // re-fetch

    console.log(
      "[prompts:04]",
      `first=${first.resolvedAt.toISOString()}`,
      `second=${second.resolvedAt.toISOString()}`,
      `refreshed=${refreshed.resolvedAt.toISOString()}`,
    );

    client.refresh();
    console.log("[prompts:04] cache cleared via client.refresh()");
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[prompts:04] failed:", error);
  process.exit(1);
});
