// Demonstrates: publishInvalid: true surfaces invalid outcomes as zero
// scores. By default (publishInvalid: false) invalid outcomes are
// dropped silently. We capture the scores that the reporter would have
// sent by using a fake tracing.score.

import { agentEvalTarget, EvalOutcome, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-eval-reporter-02" });
  try {
    const model = getStaticModel("placeholder");
    const { AgentBuilder } = await import("@anvia/core/agent");
    const agent = new AgentBuilder("invalid-agent", model).instructions("invalid").build();

    const reporter = createLangfuseEvalReporter(tracing, { publishInvalid: true });
    const result = await runEvalSuite({
      name: "invalid-suite",
      cases: [
        {
          id: "invalid-case",
          input: "anything",
          expected: "something else",
          metadata: { traceId: "00000000-0000-0000-0000-000000000012" },
        },
      ],
      target: agentEvalTarget(agent),
      metrics: [
        {
          name: "manual-invalid",
          evaluate: () => EvalOutcome.invalid("intentionally invalid"),
        },
      ],
      reporters: [reporter],
    });
    console.log("[eval-reporter:02] outcome:", result.results[0]?.metrics[0]?.outcome);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:02] failed:", error);
  process.exit(1);
});
