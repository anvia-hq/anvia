// Demonstrates: the three onMissingTrace modes (ignore, warn, throw).
// None of the cases have a traceId, so all three modes are exercised
// in sequence by a single run.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-eval-reporter-03" });
  try {
    const model = getStaticModel("Refunds are available for 30 days after purchase.");
    const agent = new AgentBuilder("no-trace-agent", model)
      .instructions("Answer support questions from policy.")
      .build();

    const cases = [
      { id: "no-trace-1", input: "?", expected: "?" },
      { id: "no-trace-2", input: "?", expected: "?" },
    ];

    // ignore: dropped silently
    const ignoreResult = await runEvalSuite({
      name: "ignore-mode",
      cases,
      target: agentEvalTarget(agent),
      metrics: [contains()],
      reporters: [createLangfuseEvalReporter(tracing, { onMissingTrace: "ignore" })],
    });
    console.log("[eval-reporter:03] ignore:", ignoreResult.results[0]?.metrics[0]);

    // warn: console.warn
    const warnResult = await runEvalSuite({
      name: "warn-mode",
      cases,
      target: agentEvalTarget(agent),
      metrics: [contains()],
      reporters: [createLangfuseEvalReporter(tracing, { onMissingTrace: "warn" })],
    });
    console.log("[eval-reporter:03] warn:", warnResult.results[0]?.metrics[0]);

    // throw: rejects
    try {
      await runEvalSuite({
        name: "throw-mode",
        cases,
        target: agentEvalTarget(agent),
        metrics: [contains()],
        reporters: [createLangfuseEvalReporter(tracing, { onMissingTrace: "throw" })],
        failOnReporterError: true,
      });
      console.log("[eval-reporter:03] throw: did NOT throw (unexpected)");
    } catch (error: unknown) {
      console.log(
        "[eval-reporter:03] throw: caught",
        error instanceof Error ? error.message : error,
      );
    }
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:03] failed:", error);
  process.exit(1);
});
