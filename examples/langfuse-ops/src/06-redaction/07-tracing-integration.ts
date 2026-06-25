// Demonstrates: redaction in langfuse.create(). redacts inputs, outputs,
// or both. Uses a static model so the LLM call is deterministic.

import { AgentBuilder } from "@anvia/core/agent";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({
    name: "langfuse-ops-redaction-07",
    redactInputs: true,
    redactOutputs: "deep",
    redaction: { replacement: "[HIDDEN]" },
  });
  try {
    const agent = new AgentBuilder("redact-agent", getStaticModel("Reach alice@example.com"))
      .instructions("Answer support questions.")
      .observe(tracing)
      .defaultMaxTurns(1)
      .build();

    const response = await agent
      .prompt("My email is alice@example.com. What is your refund policy?")
      .withTrace({ name: "redaction-tracing-demo", tags: ["redaction:07"] })
      .send();

    console.log("[redaction:07] output:", response.output);
    console.log(
      "[redaction:07] inspect the trace - input/output strings should be redacted to [HIDDEN]",
    );
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[redaction:07] failed:", error);
  process.exit(1);
});
