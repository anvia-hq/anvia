// Demonstrates: getPromptText(name). Throws if the prompt is a chat prompt.
// Set LANGFUSE_TEXT_PROMPT_NAME in your .env to a text prompt that exists
// in your Langfuse project. Defaults to "support-system-text".

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-prompts-01" });
  try {
    const client = createLangfusePromptClient(tracing);
    const name = optionalEnv("LANGFUSE_TEXT_PROMPT_NAME") ?? "support-system-text";
    const text = await client.getPromptText(name);
    console.log(`[prompts:01] ${name}:`, text);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[prompts:01] failed:", error);
  process.exit(1);
});
