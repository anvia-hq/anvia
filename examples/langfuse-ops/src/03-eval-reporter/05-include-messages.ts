// Demonstrates: includeMessages controls whether output.messages is
// included in score metadata. The case output bundles a messages array.

import { contains, runEvalSuite } from "@anvia/core/evals";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-eval-reporter-05" });
  const result = await runEvalSuite({
    name: "msgs-suite",
    cases: [
      {
        id: "with-messages",
        input: "?",
        expected: "ok",
        metadata: {
          traceId: "00000000-0000-0000-0000-000000000015",
          // The reporter reads output.messages from the case's resolved output.
          // To attach messages here we wire them through the target.
        },
      },
    ],
    target: async (input) => ({
      output: "ok",
      trace: { traceId: "00000000-0000-0000-0000-000000000015" },
      messages: [
        { role: "user", content: String(input) },
        { role: "assistant", content: "ok" },
      ],
    }),
    metrics: [contains()],
    reporters: [
      tracing.evalReporter({ includeMessages: true }),
      tracing.evalReporter({ includeMessages: false }),
    ],
  });
  console.log("[eval-reporter:05] outcome:", result.results[0]?.metrics[0]?.outcome);
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:05] failed:", error);
  process.exit(1);
});
