// Demonstrates: langfuse.create, .observe(tracing), withTrace(...), flush, shutdown.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-tracing-01" });
  try {
    const client = buildOpenAIClient();
    const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

    const response = await agent
      .prompt("Summarize ticket TICKET-1001.")
      .withTrace({
        name: "support-ticket-summary",
        userId: "user-001",
        sessionId: "session-001",
        metadata: { ticketId: "TICKET-1001" },
        tags: ["tracing:01", "basic"],
      })
      .send();

    console.log("[tracing:01] output:", response.output);
    console.log("[tracing:01] traceId:", response.trace?.traceId);
  } finally {
    await tracing.flush();
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[tracing:01] failed:", error);
  process.exit(1);
});
