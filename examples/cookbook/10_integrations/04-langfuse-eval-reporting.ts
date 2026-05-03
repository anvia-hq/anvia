import {
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  Usage,
} from "@anvia/core";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";

class StaticCompletionModel implements CompletionModel {
  readonly provider = "cookbook";
  readonly defaultModel = "static";
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
      rawResponse: {},
    };
  }
}

const reportedScores: unknown[] = [];
const reporter = createLangfuseEvalReporter({
  score: async (score) => {
    reportedScores.push(score);
  },
});

const agent = new AgentBuilder("support-agent", new StaticCompletionModel())
  .instructions("Answer support questions from policy.")
  .build();

const result = await runEvalSuite({
  name: "support-agent-regression",
  cases: [
    {
      id: "refund-window",
      input: "How long do refunds stay available?",
      expected: "30 days",
      metadata: {
        traceId: "trace-from-existing-run",
        observationId: "observation-from-existing-run",
      },
    },
  ],
  target: agentEvalTarget(agent),
  metrics: [contains()],
  reporters: [reporter],
});

console.log(result.results[0]?.metrics[0]);
console.log(reportedScores);
