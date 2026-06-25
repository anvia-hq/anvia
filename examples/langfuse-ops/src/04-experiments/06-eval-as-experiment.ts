// Demonstrates: runEvalAsExperiment. Runs a one-case eval suite and
// also posts a dataset run to Langfuse.

import { agentEvalTarget, contains } from "@anvia/core/evals";
import { createLangfuseDatasetClient, runEvalAsExperiment } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-experiments-06" });
  try {
    const model = getStaticModel("Refunds are available for 30 days after purchase.");
    const { AgentBuilder } = await import("@anvia/core/agent");
    const agent = new AgentBuilder("eval-target", model)
      .instructions("Answer support questions from policy.")
      .build();

    const datasetName = `langfuse-ops-eval-as-experiment-${Date.now()}`;
    const result = await runEvalAsExperiment(
      {
        name: "eval-as-experiment-suite",
        cases: [
          {
            id: "refund-window",
            input: "How long do refunds stay available?",
            expected: "30 days",
          },
        ],
        target: agentEvalTarget(agent),
        metrics: [contains()],
        reporters: [],
      },
      {
        tracing,
        client: createLangfuseDatasetClient(tracing),
        datasetName,
        runName: `run-${Date.now()}`,
      },
    );
    console.log(
      "[experiments:06] suite.passed:",
      result.suite.passed,
      "datasetRun.posted:",
      result.datasetRun.posted,
    );
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[experiments:06] failed:", error);
  process.exit(1);
});
