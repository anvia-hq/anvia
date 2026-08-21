// Demonstrates: cacheTtlMs, the refresh: true flag, and client.refresh().

import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-prompts-04" });
  const client = tracing.promptClient({ cacheTtlMs: 60_000 });
  const name = optionalEnv("LANGFUSE_TEXT_PROMPT_NAME") ?? "support-system-text";

  const first = await client.getPrompt({ name: name });
  const second = await client.getPrompt({ name: name }); // cache hit
  const refreshed = await client.getPrompt({ name: name, refresh: true }); // re-fetch

  console.log(
    "[prompts:04]",
    `first=${first.resolvedAt.toISOString()}`,
    `second=${second.resolvedAt.toISOString()}`,
    `refreshed=${refreshed.resolvedAt.toISOString()}`,
  );

  client.refresh();
  console.log("[prompts:04] cache cleared via client.refresh()");
}

main().catch((error: unknown) => {
  console.error("[prompts:04] failed:", error);
  process.exit(1);
});
