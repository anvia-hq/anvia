import { contains, exactMatch, runEvalSuite } from "@anvia/core/evals";

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

const result = await runEvalSuite({
  name: "support-basic-metrics",
  cases,
  target: async (input) => answerSupportQuestion(input),
  metrics: [
    exactMatch(),
    contains({
      expected: ({ case: testCase }) =>
        testCase.id === "refund-window" ? "30 days" : "Workspace owners",
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
    return "Refunds are available for 30 days.";
  }
  if (question.includes("billing")) {
    return "Workspace owners can change billing settings.";
  }
  return "Please contact support.";
}
