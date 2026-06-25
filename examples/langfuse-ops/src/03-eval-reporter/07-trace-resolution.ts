// Demonstrates: the three trace resolution tiers. Each case uses a
// different tier so we can verify all three at once.

import { AgentBuilder } from "@anvia/core/agent";
import { contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-eval-reporter-07" });
  try {
    const model = getStaticModel("ok");
    const _agent = new AgentBuilder("resolve-agent", model).instructions("ok").build();

    // Tier 1: output.trace (most direct, set by agent run)
    // Tier 2: case.input.trace (bundled in case input)
    // Tier 3: case.metadata.traceId / observationId
    const tier3TraceId = "00000000-0000-0000-0000-000000000017";
    const result = await runEvalSuite({
      name: "resolution-suite",
      cases: [
        {
          id: "tier-3",
          input: "ok",
          expected: "ok",
          metadata: {
            traceId: tier3TraceId,
            observationId: "obs-tier-3",
          },
        },
      ],
      target: async (input) => ({
        output: String(input),
        trace: { traceId: "00000000-0000-0000-0000-000000000017a" },
      }),
      metrics: [contains()],
      reporters: [createLangfuseEvalReporter(tracing)],
    });
    console.log("[eval-reporter:07] outcome:", result.results[0]?.metrics[0]?.outcome);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:07] failed:", error);
  process.exit(1);
});
