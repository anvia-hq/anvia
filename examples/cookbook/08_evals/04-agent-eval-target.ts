import type { AgentResponse } from "@anvia/core/agent";
import { Agent } from "@anvia/core/agent";
import { agentEvalTarget, contains, exactMatch, runEvalSuite } from "@anvia/core/evals";
import { OpenAIClient } from "@anvia/openai";

const openAIClient = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const model = openAIClient.completionModel("gpt-5.5");

const agent = new Agent({
  id: "support-policy-agent",
  model: model,
  instructions: [
    "Answer with only the relevant policy fact.",
    "Use these exact policy phrases when relevant:",
    "- Refunds are available for 30 days.",
    "- Workspace owners can change billing settings.",
  ].join("\n"),
});

const cases = [
  {
    id: "refund-window",
    input: "When can I request a refund?",
    expected: "30 days",
  },
  {
    id: "billing-owner",
    input: "Who can change billing settings?",
    expected: "Workspace owners",
  },
];

const result = await runEvalSuite({
  name: "support-agent-target",
  cases,
  target: agentEvalTarget<string>(agent),
  metrics: [
    contains<string, AgentResponse, string>({
      actual: ({ output }) => output.output,
    }),
    exactMatch<string, AgentResponse, string>({
      name: "not_blank",
      actual: ({ output }) => output.output.trim().length > 0,
      expected: true,
    }),
  ],
});

console.table(
  result.results.flatMap((caseResult) =>
    caseResult.metrics.map((metric) => ({
      case: caseResult.case.id,
      metric: metric.metricName,
      outcome: metric.outcome.outcome,
      score: metric.outcome.score ?? "",
      output: caseResult.output?.output ?? "",
      comment: metric.outcome.comment ?? "",
    })),
  ),
);

console.log({
  passed: result.metrics.passed,
  failed: result.metrics.failed,
  invalid: result.metrics.invalid,
});
