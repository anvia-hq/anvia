// Demonstrates: runEvalSuite + createLangfuseEvalReporter writing scores
// to a real Langfuse trace. The case bundles a traceId in metadata so
// the reporter can resolve the trace.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-eval-reporter-01" });
  try {
    const model = getStaticModel("Refunds are available for 30 days after purchase.");
    const agent = new AgentBuilder("support-agent", model)
      .instructions("Answer support questions from policy.")
      .build();

    const result = await runEvalSuite({
      name: "support-agent-regression",
      cases: [
        {
          id: "refund-window",
          input: "How long do refunds stay available?",
          expected: "30 days",
          metadata: {
            traceId: "00000000-0000-0000-0000-000000000011",
            observationId: "obs-refund-window",
          },
        },
      ],
      target: agentEvalTarget(agent),
      metrics: [contains()],
      reporters: [createLangfuseEvalReporter(tracing)],
    });
    console.log("[eval-reporter:01] result:", result.results[0]?.metrics[0]);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:01] failed:", error);
  process.exit(1);
});
