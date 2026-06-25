// One-shot end-to-end demo: build a real Anvia agent, trace it, attach scores,
// run a one-case eval suite with the Langfuse eval reporter, flush, then log
// every artifact ID.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseDatasetClient, createLangfuseEvalReporter } from "@anvia/langfuse";
import { buildSupportAgent, getTicket } from "./_support/agent.js";
import { buildOpenAIClient, defaultModel } from "./_support/model.js";
import { createTracing } from "./_support/tracing.js";

const datasetName = `quickstart-dataset-${Date.now()}`;

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-quickstart" });
  try {
    const langfuseBaseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
    const client = buildOpenAIClient();
    const agent = buildSupportAgent(client.completionModel(defaultModel()), {
      tracing,
      tools: [getTicket],
    });

    const response = await agent
      .prompt("Summarize ticket TICKET-1001 for the product engineering team.")
      .withTrace({
        name: "quickstart-support-ticket",
        userId: "quickstart-user",
        sessionId: "quickstart-session",
        metadata: { example: "00-quickstart" },
        tags: ["langfuse-ops", "quickstart"],
      })
      .send();

    console.log("[quickstart] agent output:", response.output);
    console.log("[quickstart] trace:", response.trace?.traceId);
    if (response.trace?.traceId !== undefined) {
      console.log(
        "[quickstart] inspect in Langfuse:",
        `${langfuseBaseUrl.replace(/\/$/, "")} (trace ${response.trace.traceId})`,
      );
    }

    if (response.trace?.traceId !== undefined) {
      await tracing.score({
        traceId: response.trace.traceId,
        name: "quality",
        value: 0.92,
        dataType: "NUMERIC",
        comment: "Heuristic quality score from quickstart demo",
      });
      await tracing.score({
        traceId: response.trace.traceId,
        name: "verdict",
        value: "pass",
        dataType: "CATEGORICAL",
        configId: "quickstart-verdict",
      });
    }

    const evalCase = {
      id: "q-1",
      input: "How long do refunds stay available?",
      expected: "30 days",
      ...(response.trace?.traceId === undefined
        ? {}
        : {
            metadata: {
              traceId: response.trace.traceId,
              observationId: response.trace.observationId,
            },
          }),
    };
    const evalAgent = new AgentBuilder("eval-target", client.completionModel(defaultModel()))
      .instructions("Answer with a short factual sentence.")
      .defaultMaxTurns(1)
      .build();
    const evalResult = await runEvalSuite({
      name: "quickstart-suite",
      cases: [evalCase],
      target: agentEvalTarget(evalAgent),
      metrics: [contains()],
      reporters: [createLangfuseEvalReporter(tracing)],
    });
    console.log("[quickstart] eval result:", evalResult.results[0]?.metrics[0]);

    const datasetClient = createLangfuseDatasetClient(tracing);
    await datasetClient.createDataset({ name: datasetName });
    console.log("[quickstart] scores: quality, verdict, contains");
    console.log("[quickstart] dataset:", datasetName);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[quickstart] failed:", error);
  process.exit(1);
});
