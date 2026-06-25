// Demonstrates: serviceName flowing into the OTel `service.name` resource
// attribute and onto the root run observation.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-tracing-05" });
  try {
    const client = buildOpenAIClient();
    const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

    const response = await agent
      .prompt("Summarize ticket TICKET-1001.")
      .withTrace({ name: "service-name-demo", tags: ["tracing:05"] })
      .send();

    console.log("[tracing:05] output:", response.output);
    console.log(
      "[tracing:05] serviceName `langfuse-ops-tracing-05` should appear in the root observation metadata",
    );
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[tracing:05] failed:", error);
  process.exit(1);
});
