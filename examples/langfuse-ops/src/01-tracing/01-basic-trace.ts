// Demonstrates: an owned Langfuse client, named observer registration, and automatic disposal.

import { assertCompleted, buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-tracing-01" });
  const client = buildOpenAIClient();
  const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

  const response = await agent.generate({
    prompt: "Summarize ticket TICKET-1001.",
    trace: {
      name: "support-ticket-summary",
      userId: "user-001",
      sessionId: "session-001",
      metadata: { ticketId: "TICKET-1001" },
      tags: ["tracing:01", "basic"],
    },
  });
  assertCompleted(response);

  console.log("[tracing:01] output:", response.output);
  console.log("[tracing:01] traceId:", response.trace?.traceId);
}

main().catch((error: unknown) => {
  console.error("[tracing:01] failed:", error);
  process.exit(1);
});
