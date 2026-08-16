// Demonstrates: client.runEvalExperiment(). Runs a one-case eval suite and
// also posts a dataset run to Langfuse.

import { agentEvalTarget, contains } from "@anvia/core/evals";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-experiments-06" });
  const model = getStaticModel("Refunds are available for 30 days after purchase.");
  const { Agent } = await import("@anvia/core/agent");
  const agent = new Agent({
    id: "eval-target",
    model: model,
    instructions: "Answer support questions from policy.",
  });

  const datasetName = `langfuse-ops-eval-as-experiment-${Date.now()}`;
  const datasetClient = tracing.datasetClient();
  await datasetClient.createDataset({ name: datasetName });

  const result = await tracing.runEvalExperiment({
    suite: {
      name: "eval-as-experiment-suite",
      cases: [
        {
          id: "refund-window",
          input: "How long do refunds stay available?",
          expected: "30 days",
        },
      ],
      target: agentEvalTarget<string>({
        agent: agent,
        request: ({ input }) => ({ prompt: input }),
      }),
      metrics: [contains()],
      reporters: [],
    },
    experiment: {
      datasetName,
      runName: `run-${Date.now()}`,
    },
  });
  console.log(
    "[experiments:06] suite.passed:",
    result.suite.metrics.passed,
    "datasetRun.posted:",
    result.datasetRun.posted,
  );
}

main().catch((error: unknown) => {
  console.error("[experiments:06] failed:", error);
  process.exit(1);
});
