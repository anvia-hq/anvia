// Demonstrates: explicit trace provenance on an Agent result. Observer clients
// do not expose ambient "current trace" state because concurrent runs would
// make such a handle ambiguous.

import { assertCompleted, buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModelId } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-tracing-03" });
  const client = buildOpenAIClient();
  const agent = buildSupportAgent(
    client.completionModel({ modelId: defaultModelId(), api: "responses" }),
    { tracing },
  );

  const response = await agent.generate({
    prompt: "Summarize ticket TICKET-1001.",
    trace: { name: "explicit-trace-demo", tags: ["tracing:03"] },
  });
  assertCompleted(response);

  console.log("[tracing:03] output:", response.output);
  console.log("[tracing:03] observer:", response.trace?.observer);
  console.log("[tracing:03] traceId:", response.trace?.traceId);
  console.log("[tracing:03] observationId:", response.trace?.observationId);
}

main().catch((error: unknown) => {
  console.error("[tracing:03] failed:", error);
  process.exit(1);
});
