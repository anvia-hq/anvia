import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-prompts-02" });
  const client = tracing.promptClient();
  const name = optionalEnv("LANGFUSE_CHAT_PROMPT_NAME") ?? "support-system-chat";
  const messages = await client.getPromptChat({ name: name });
  console.log(`[prompts:02] ${name}:`, messages);
}

main().catch((error: unknown) => {
  console.error("[prompts:02] failed:", error);
  process.exit(1);
});
