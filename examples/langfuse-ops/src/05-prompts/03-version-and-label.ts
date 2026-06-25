// Demonstrates: getPrompt(name, { version }) and getPrompt(name, { label }).
// Set LANGFUSE_VERSIONED_PROMPT_NAME in your .env to a prompt that has
// multiple versions and labels.

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-prompts-03" });
  try {
    const client = createLangfusePromptClient(tracing);
    const name = optionalEnv("LANGFUSE_VERSIONED_PROMPT_NAME") ?? "support-system";

    const byVersion = await client.getPrompt(name, { version: 1 });
    console.log(`[prompts:03] version=1: ${byVersion.name}@${byVersion.version}`);

    const byLabel = await client.getPrompt(name, { label: "production" });
    console.log(`[prompts:03] label=production: ${byLabel.name}@${byLabel.version}`);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[prompts:03] failed:", error);
  process.exit(1);
});
