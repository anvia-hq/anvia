// Demonstrates: promptRef on AgentRunStartArgs (new API) and
// promptName/promptVersion on trace.metadata (legacy back-compat).
// The trace will link the generation to the prompt version.

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

    // New API: promptRef flows through `trace.metadata` (keys
    // `promptName` + `promptVersion`). The tracing observer also accepts
    // a typed `promptRef` on `AgentRunStartArgs`, but `withTrace(...)`
    // itself only exposes `AgentTraceOptions`, so the metadata path is
    // the public one for this code path.
    const response = await agent
      .prompt("Summarize ticket TICKET-1001.")
      .withTrace({
        name: "prompt-link-demo",
        tags: ["prompts:05"],
        metadata: { promptName: prompt.name, promptVersion: prompt.version },
      })
      .send();
    console.log("[prompts:05] output (promptRef):", response.output);

    // Legacy: promptName/promptVersion on metadata
    const response2 = await agent
      .prompt("Summarize ticket TICKET-1001.")
      .withTrace({
        name: "prompt-link-legacy",
        tags: ["prompts:05", "legacy"],
        metadata: { promptName: prompt.name, promptVersion: prompt.version },
      })
      .send();
    console.log("[prompts:05] output (metadata):", response2.output);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[prompts:05] failed:", error);
  process.exit(1);
});
