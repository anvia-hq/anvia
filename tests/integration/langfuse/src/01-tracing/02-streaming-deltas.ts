// Demonstrates: streaming agent output and the text_delta/reasoning_delta/
// tool_call updates on the generation observation in Langfuse.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModelId } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-tracing-02" });
  const client = buildOpenAIClient();
  const agent = buildSupportAgent(
    client.completionModel({ modelId: defaultModelId(), api: "responses" }),
    { tracing },
  );

  const stream = agent.stream({
    prompt: "Give me a one-paragraph summary of ticket TICKET-1001.",
    trace: { name: "streaming-trace", tags: ["tracing:02", "streaming"] },
  });

  let textLength = 0;
  for await (const event of stream) {
    if (event.type === "text_delta") {
      textLength += event.delta.length;
    }
  }
  console.log("[tracing:02] streamed text length:", textLength);
  console.log("[tracing:02] inspect the trace in Langfuse to see text_delta updates");
}

main().catch((error: unknown) => {
  console.error("[tracing:02] failed:", error);
  process.exit(1);
});
