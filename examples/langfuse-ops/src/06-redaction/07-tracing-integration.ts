// Demonstrates: observer-scoped redaction of inputs, outputs,
// or both. Uses a static model so the LLM call is deterministic.

import { Agent } from "@anvia/core/agent";
import { assertCompleted } from "../_support/agent.js";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({
    name: "langfuse-ops-redaction-07",
  });
  const agent = new Agent({
    id: "redact-agent",
    model: getStaticModel("Reach alice@example.com"),
    instructions: "Answer support questions.",
    maxTurns: 1,
    observability: {
      observers: {
        langfuse: tracing.observer({
          redactInputs: true,
          redactOutputs: "deep",
          redaction: { replacement: "[HIDDEN]" },
        }),
      },
      primaryTrace: "langfuse",
    },
  });

  const response = await agent.generate({
    prompt: "My email is alice@example.com. What is your refund policy?",
    trace: { name: "redaction-tracing-demo", tags: ["redaction:07"] },
  });
  assertCompleted(response);

  console.log("[redaction:07] output:", response.output);
  console.log(
    "[redaction:07] inspect the trace - input/output strings should be redacted to [HIDDEN]",
  );
}

main().catch((error: unknown) => {
  console.error("[redaction:07] failed:", error);
  process.exit(1);
});
