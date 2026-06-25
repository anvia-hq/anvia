// Demonstrates: linking a prompt version to a trace through
// trace.metadata keys promptName/promptVersion.

import { createLangfusePromptClient } from "@anvia/langfuse";
import { buildSupportAgent } from "../_support/agent.js";
import { optionalEnv } from "../_support/env.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-prompts-05" });
  try {
    const client = createLangfusePromptClient(tracing);
    const name = optionalEnv("LANGFUSE_TEXT_PROMPT_NAME") ?? "support-system-text";
    const prompt = await client.getPrompt(name);

    const anviaClient = buildOpenAIClient();
    const agent = buildSupportAgent(anviaClient.completionModel(defaultModel()), { tracing });

    // withTrace exposes AgentTraceOptions, so prompt linkage is provided
    // through metadata on this code path.
    const response = await agent
      .prompt("Summarize ticket TICKET-1001.")
      .withTrace({
        name: "prompt-link-demo",
        tags: ["prompts:05"],
        metadata: { promptName: prompt.name, promptVersion: prompt.version },
      })
      .send();
    console.log("[prompts:05] output (metadata):", response.output);

    // Repeat with a second trace to show the same prompt metadata on another run.
    const response2 = await agent
      .prompt("Summarize ticket TICKET-1001.")
      .withTrace({
        name: "prompt-link-repeat",
        tags: ["prompts:05", "repeat"],
        metadata: { promptName: prompt.name, promptVersion: prompt.version },
      })
      .send();
    console.log("[prompts:05] output (metadata repeat):", response2.output);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[prompts:05] failed:", error);
  process.exit(1);
});
