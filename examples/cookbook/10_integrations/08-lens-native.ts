import {
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  Usage,
} from "@anvia/core";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLensEvalReporter, lens } from "@anvia/lens";

class StaticSupportModel implements CompletionModel {
  readonly provider = "smoke";
  readonly defaultModel = "static-support";
  readonly capabilities = {
    streaming: false,
    tools: false,
    toolChoice: false,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  };

  async completion(_request: CompletionRequest): Promise<CompletionResponse> {
    return {
      choice: [AssistantContent.text("Refunds are available for 30 days after purchase.")],
      usage: Usage.empty(),
      rawResponse: { source: "static-smoke-model" },
    };
  }
}

const tracing = lens.create();
const reporter = createLensEvalReporter(tracing, { includePayloads: true });
const agent = new AgentBuilder("lens-native-smoke", new StaticSupportModel())
  .name("Lens Native Smoke")
  .instructions("Answer support questions from the supplied policy.")
  .observe(tracing)
  .build();

try {
  const suite = await runEvalSuite({
    name: "lens-native-smoke",
    run: { datasetName: "lens-smoke", datasetVersion: "v3" },
    cases: [
      {
        id: "refund-window",
        input: "How long are refunds available?",
        expected: "30 days",
      },
    ],
    target: agentEvalTarget(agent),
    metrics: [contains({ name: "refund-policy-correctness" })],
    reporters: [reporter],
    failOnReporterError: true,
  });
  await tracing.flush();

  const result = suite.results[0];
  console.log(
    JSON.stringify(
      {
        suite: suite.name,
        runId: suite.run.id,
        caseId: result?.case.id,
        outcome: result?.metrics[0]?.outcome.outcome,
        trace: result?.output?.trace,
      },
      null,
      2,
    ),
  );
} finally {
  await tracing.shutdown();
}
