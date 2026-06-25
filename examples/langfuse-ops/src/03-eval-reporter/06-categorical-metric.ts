// Demonstrates: defineMetric({ dataType, configId, metadata }) for
// CATEGORICAL and BOOLEAN metrics. The reporter forwards dataType,
// configId, and metadata to Langfuse.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, defineMetric, EvalOutcome, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-eval-reporter-06" });
  try {
    const model = getStaticModel("ok");
    const agent = new AgentBuilder("cat-agent", model).instructions("ok").build();

    const categorical = defineMetric({
      name: "verdict",
      dataType: "CATEGORICAL",
      configId: "ops-verdict",
      metadata: { source: "judge-llm" },
      evaluate: () => EvalOutcome.pass("good"),
    });

    const boolean = defineMetric({
      name: "grounded",
      dataType: "BOOLEAN",
      configId: "ops-grounded",
      evaluate: () => EvalOutcome.pass(1),
    });

    const result = await runEvalSuite({
      name: "categorical-suite",
      cases: [
        {
          id: "cat-1",
          input: "?",
          expected: "ok",
          metadata: { traceId: "00000000-0000-0000-0000-000000000016" },
        },
      ],
      target: agentEvalTarget(agent),
      metrics: [categorical, boolean],
      reporters: [createLangfuseEvalReporter(tracing)],
    });
    console.log("[eval-reporter:06] metrics:", result.results[0]?.metrics);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:06] failed:", error);
  process.exit(1);
});
