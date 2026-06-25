// Demonstrates: a multi-turn agent run, where the trace spans multiple
// generations and may show cache hits on the second turn.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-tracing-06" });
  try {
    const client = buildOpenAIClient();
    const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

    const first = await agent
      .prompt("What ticket is TICKET-1001 about? Give a one-line summary.")
      .withTrace({ name: "multi-turn-demo", tags: ["tracing:06", "turn-1"] })
      .send();
    console.log("[tracing:06] turn 1:", first.output);

    const second = await agent
      .prompt("Now rewrite the summary in two sentences.")
      .withTrace({ name: "multi-turn-demo", tags: ["tracing:06", "turn-2"] })
      .send();
    console.log("[tracing:06] turn 2:", second.output);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[tracing:06] failed:", error);
  process.exit(1);
});
