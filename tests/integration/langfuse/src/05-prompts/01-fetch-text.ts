import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-prompts-01" });
  const client = tracing.promptClient();
  const name = optionalEnv("LANGFUSE_TEXT_PROMPT_NAME") ?? "support-system-text";
  const text = await client.getPromptText({ name: name });
  console.log(`[prompts:01] ${name}:`, text);
}

main().catch((error: unknown) => {
  console.error("[prompts:01] failed:", error);
  process.exit(1);
});
