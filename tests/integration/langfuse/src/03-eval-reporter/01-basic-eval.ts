// Demonstrates: runEvalSuite + client.evalReporter() writing scores
// to a real Langfuse trace. The case bundles a traceId in metadata so
// the reporter can resolve the trace.

import { Agent } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-eval-reporter-01" });
  const model = getStaticModel("Refunds are available for 30 days after purchase.");
  const agent = new Agent({
    id: "support-agent",
    model: model,
    instructions: "Answer support questions from policy.",
  });

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
    target: agentEvalTarget<string>({ agent: agent, request: ({ input }) => ({ prompt: input }) }),
    metrics: [contains()],
    reporters: [tracing.evalReporter()],
  });
  console.log("[eval-reporter:01] result:", result.results[0]?.metrics[0]);
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:01] failed:", error);
  process.exit(1);
});
