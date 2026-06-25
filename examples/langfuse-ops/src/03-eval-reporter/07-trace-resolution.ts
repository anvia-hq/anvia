// Demonstrates: the three trace resolution tiers. Each case uses a
// different tier so we can verify all three at once.

import { contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-eval-reporter-07" });
  try {
    const tier1TraceId = "00000000-0000-0000-0000-000000000171";
    const tier2TraceId = "00000000-0000-0000-0000-000000000172";
    const tier3TraceId = "00000000-0000-0000-0000-000000000173";
    const result = await runEvalSuite({
      name: "resolution-suite",
      cases: [
        {
          id: "tier-1-output-trace",
          input: { answer: "ok", traceSource: "output" },
          expected: "ok",
        },
        {
          id: "tier-2-input-trace",
          input: {
            answer: "ok",
            trace: { traceId: tier2TraceId, observationId: "obs-tier-2" },
          },
          expected: "ok",
        },
        {
          id: "tier-3-metadata-trace",
          input: "ok",
          expected: "ok",
          metadata: {
            traceId: tier3TraceId,
            observationId: "obs-tier-3",
          },
        },
      ],
      target: async (input) => {
        if (typeof input === "object" && input !== null && "traceSource" in input) {
          return {
            output: "ok",
            trace: { traceId: tier1TraceId, observationId: "obs-tier-1" },
          };
        }
        if (typeof input === "object" && input !== null && "answer" in input) {
          return { output: String(input.answer) };
        }
        return { output: String(input) };
      },
      metrics: [contains()],
      reporters: [createLangfuseEvalReporter(tracing)],
    });
    console.log(
      "[eval-reporter:07] outcomes:",
      result.results.map((caseResult) => caseResult.metrics[0]?.outcome),
    );
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:07] failed:", error);
  process.exit(1);
});
