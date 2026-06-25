// Demonstrates: truncateInputAt caps the byte size of caseInputSummary
// and caseExpectedSummary metadata keys, appending `<truncated>`.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-eval-reporter-04" });
  try {
    const model = getStaticModel("x");
    const agent = new AgentBuilder("truncation-agent", model).instructions("x").build();

    const longInput = "lorem ipsum ".repeat(500); // > 6 KB
    const result = await runEvalSuite({
      name: "truncation-suite",
      cases: [
        {
          id: "long-input",
          input: longInput,
          expected: longInput,
          metadata: { traceId: "00000000-0000-0000-0000-000000000014" },
        },
      ],
      target: agentEvalTarget(agent),
      metrics: [contains()],
      reporters: [createLangfuseEvalReporter(tracing, { truncateInputAt: 256 })],
    });
    console.log("[eval-reporter:04] outcome:", result.results[0]?.metrics[0]?.outcome);
    console.log(
      "[eval-reporter:04] inspect the score metadata in Langfuse to see caseInputSummary truncated to 256 bytes with `<truncated>`",
    );
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:04] failed:", error);
  process.exit(1);
});
