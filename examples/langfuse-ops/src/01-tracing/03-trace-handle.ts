// Demonstrates: getCurrentTrace(), addEvent, and addAttributes. The trace
// handle is only valid while a run is in flight, so the demo wires a
// `withHook` hook that reaches the handle via `tracing.getCurrentTrace()`
// and emits ad-hoc checkpoint events + attributes from the run lifecycle.

import { createHook } from "@anvia/core/hooks";
import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-tracing-03" });
  try {
    const client = buildOpenAIClient();
    const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

    // Before any run: handle is undefined.
    console.log("[tracing:03] pre-run handle:", tracing.getCurrentTrace());

    const response = await agent
      .prompt("Summarize ticket TICKET-1001.")
      .withTrace({ name: "trace-handle-demo", tags: ["tracing:03"] })
      .withHook(
        createHook({
          onRunStart() {
            const handle = tracing.getCurrentTrace();
            handle?.addEvent("checkpoint.started", { phase: "pre-inference" });
            handle?.addAttributes({ quality: "high" });
          },
          onTurnStart() {
            const handle = tracing.getCurrentTrace();
            handle?.addEvent("checkpoint.inference", { phase: "llm" });
          },
          onRunEnd({ output }) {
            const handle = tracing.getCurrentTrace();
            handle?.addEvent("checkpoint.done", { outputLength: output.length });
          },
        }),
      )
      .send();

    // After the run: handle is cleared.
    console.log("[tracing:03] post-run handle:", tracing.getCurrentTrace());

    console.log("[tracing:03] output:", response.output);
    console.log("[tracing:03] traceId:", response.trace?.traceId);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[tracing:03] failed:", error);
  process.exit(1);
});
