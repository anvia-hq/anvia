// Demonstrates: getPromptChat(name). Throws if the prompt is a text prompt.
// Set LANGFUSE_CHAT_PROMPT_NAME in your .env to a chat prompt that exists.

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-prompts-02" });
  try {
    const client = createLangfusePromptClient(tracing);
    const name = optionalEnv("LANGFUSE_CHAT_PROMPT_NAME") ?? "support-system-chat";
    const messages = await client.getPromptChat(name);
    console.log(`[prompts:02] ${name}:`, messages);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[prompts:02] failed:", error);
  process.exit(1);
});
