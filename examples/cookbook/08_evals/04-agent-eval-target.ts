import { AgentBuilder, type PromptResponse } from "@anvia/core/agent";
import { agentEvalTarget, contains, exactMatch, runEvalSuite } from "@anvia/core/evals";
import { OpenAIClient } from "@anvia/openai";

const openAIClient = new OpenAIClient({ apiKey: requireEnv("OPENAI_API_KEY") });
const model = openAIClient.completionModel(process.env.OPENAI_MODEL ?? "gpt-5.5");

const agent = new AgentBuilder("support-policy-agent", model)
  .instructions(
    [
      "Answer with only the relevant policy fact.",
      "Use these exact policy phrases when relevant:",
      "- Refunds are available for 30 days.",
      "- Workspace owners can change billing settings.",
    ].join("\n"),
  )
  .build();

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
    contains<string, PromptResponse, string>({
      actual: ({ output }) => output.output,
    }),
    exactMatch<string, PromptResponse, string>({
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
  passed: result.passed,
  failed: result.failed,
  invalid: result.invalid,
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Set ${name} before running this cookbook example.`);
  }
  return value;
}
