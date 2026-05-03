import { contains, runEvalSuite, semanticSimilarity } from "@anvia/core/evals";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

const cases = [
  {
    id: "refund-window",
    input: "When can I request a refund?",
    expected: "Refunds are available for 30 days.",
  },
  {
    id: "billing-owner",
    input: "Who can change billing settings?",
    expected: "Workspace owners can change billing settings.",
  },
];

const embeddingModel = await createTransformersEmbeddingModel();

const result = await runEvalSuite({
  name: "support-semantic-similarity",
  cases,
  target: async (input) => answerSupportQuestion(input),
  metrics: [
    semanticSimilarity({
      model: embeddingModel,
      threshold: 0.75,
    }),
    contains({
      expected: ({ case: testCase }) =>
        testCase.id === "refund-window" ? "30 day" : "workspace owners",
    }),
  ],
  concurrency: 2,
});

console.table(
  result.results.flatMap((caseResult) =>
    caseResult.metrics.map((metric) => ({
      case: caseResult.case.id,
      metric: metric.metricName,
      outcome: metric.outcome.outcome,
      score: typeof metric.outcome.score === "number" ? metric.outcome.score.toFixed(3) : "",
      comment: metric.outcome.comment ?? "",
    })),
  ),
);

console.log({
  passed: result.passed,
  failed: result.failed,
  invalid: result.invalid,
});

function answerSupportQuestion(question: string): string {
  if (question.includes("refund")) {
    return "A customer can ask for a refund during the 30 day refund period.";
  }
  if (question.includes("billing")) {
    return "Only workspace owners are allowed to update billing settings.";
  }
  return "Please contact support.";
}
