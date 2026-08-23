// Demonstrates: the three onMissingTrace modes (ignore, warn, throw).
// None of the cases have a traceId, so all three modes are exercised
// in sequence by a single run.

import { Agent } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-eval-reporter-03" });
  const model = getStaticModel("Refunds are available for 30 days after purchase.");
  const agent = new Agent({
    id: "no-trace-agent",
    model: model,
    instructions: "Answer support questions from policy.",
  });

  const cases = [
    { id: "no-trace-1", input: "?", expected: "?" },
    { id: "no-trace-2", input: "?", expected: "?" },
  ];

  // ignore: dropped silently
  const ignoreResult = await runEvalSuite({
    name: "ignore-mode",
    cases,
    target: agentEvalTarget<string>({ agent: agent, request: ({ input }) => ({ prompt: input }) }),
    metrics: [contains()],
    reporters: [tracing.evalReporter({ onMissingTrace: "ignore" })],
  });
  console.log("[eval-reporter:03] ignore:", ignoreResult.results[0]?.metrics[0]);

  // warn: console.warn
  const warnResult = await runEvalSuite({
    name: "warn-mode",
    cases,
    target: agentEvalTarget<string>({ agent: agent, request: ({ input }) => ({ prompt: input }) }),
    metrics: [contains()],
    reporters: [tracing.evalReporter({ onMissingTrace: "warn" })],
  });
  console.log("[eval-reporter:03] warn:", warnResult.results[0]?.metrics[0]);

  // throw: rejects
  try {
    await runEvalSuite({
      name: "throw-mode",
      cases,
      target: agentEvalTarget<string>({
        agent: agent,
        request: ({ input }) => ({ prompt: input }),
      }),
      metrics: [contains()],
      reporters: [tracing.evalReporter({ onMissingTrace: "throw" })],
      reporterErrorPolicy: "throw",
    });
    console.log("[eval-reporter:03] throw: did NOT throw (unexpected)");
  } catch (error: unknown) {
    console.log("[eval-reporter:03] throw: caught", error instanceof Error ? error.message : error);
  }
}

main().catch((error: unknown) => {
  console.error("[eval-reporter:03] failed:", error);
  process.exit(1);
});
