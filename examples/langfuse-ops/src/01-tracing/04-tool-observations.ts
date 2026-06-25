// Demonstrates: tool observations in Langfuse. The tool span carries
// toolDefinition, toolMetadata, and structuredResult on the matching
// observation in the trace.

import { buildSupportAgent, getTicket } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-tracing-04" });
  try {
    const client = buildOpenAIClient();
    const agent = buildSupportAgent(client.completionModel(defaultModel()), {
      tracing,
      tools: [getTicket],
    });

    const response = await agent
      .prompt("Look up ticket TICKET-1001 and summarize the issue.")
      .withTrace({ name: "tool-observations-demo", tags: ["tracing:04"] })
      .send();

    console.log("[tracing:04] output:", response.output);
    console.log(
      "[tracing:04] inspect the trace to see the tool span with toolDefinition, toolMetadata, and structuredResult",
    );
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[tracing:04] failed:", error);
  process.exit(1);
});
