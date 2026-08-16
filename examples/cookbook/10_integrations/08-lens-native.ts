import {
  Agent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  Usage,
} from "@anvia/core";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { LensClient } from "@anvia/lens";

class StaticSupportModel implements CompletionModel {
  readonly provider = "smoke";
  readonly modelId = "static-support";
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
      choice: [{ type: "text", text: "Refunds are available for 30 days after purchase." }],
      usage: Usage.empty(),
      rawResponse: { source: "static-smoke-model" },
    };
  }
}

await using lens = new LensClient({ serviceName: "lens-native-smoke" });
const agent = new Agent({
  id: "lens-native-smoke",
  model: new StaticSupportModel(),
  name: "Lens Native Smoke",
  instructions: "Answer support questions from the supplied policy.",
  observability: {
    observers: { lens: lens.observer() },
    primaryTrace: "lens",
  },
});

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
  target: agentEvalTarget<string>({
    agent,
    request: ({ input }) => ({ prompt: input }),
  }),
  metrics: [contains({ name: "refund-policy-correctness" })],
  reporters: [lens.evalReporter({ includePayloads: true })],
  reporterErrorPolicy: "throw",
});
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
