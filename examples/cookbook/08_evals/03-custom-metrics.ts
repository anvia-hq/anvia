import { contains, defineEvalSuite, EvalOutcome, runEvalSuite } from "@anvia/core/evals";

const cases = [
  {
    id: "refund-window",
    input: "When can I request a refund?",
    expected: "30 days",
  },
  {
    id: "security-owner",
    input: "Who handles security incidents?",
    expected: "incident commander",
  },
  {
    id: "unknown-policy",
    input: "Can I transfer a subscription?",
  },
];

const supportEvals = defineEvalSuite<string, string, string | undefined>();

const suite = defineEvalSuite({
  name: "support-custom-metrics",
  cases,
  target: async (input) => answerSupportQuestion(input),
  metrics: [
    contains({
      expected: ({ case: testCase }) =>
        typeof testCase.expected === "string" ? testCase.expected : "",
    }),
    supportEvals.defineMetric({
      name: "no_support_handoff",
      dataType: "BOOLEAN",
      evaluate: ({ output }) =>
        output.includes("contact support")
          ? EvalOutcome.fail(false, { comment: "Answer fell back to support handoff." })
          : EvalOutcome.pass(true),
    }),
    supportEvals.defineMetric({
      name: "has_expectation",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase }) =>
        testCase.expected === undefined
          ? EvalOutcome.invalid("Case has no expected value.")
          : EvalOutcome.pass(true),
    }),
  ],
});
const result = await runEvalSuite(suite);

console.table(
  result.results.flatMap((caseResult) =>
    caseResult.metrics.map((metric) => ({
      case: caseResult.case.id,
      metric: metric.metricName,
      outcome: metric.outcome.outcome,
      score: metric.outcome.score ?? "",
      comment: metric.outcome.comment ?? ("reason" in metric.outcome ? metric.outcome.reason : ""),
    })),
  ),
);

console.log({
  passed: result.metrics.passed,
  failed: result.metrics.failed,
  invalid: result.metrics.invalid,
});

function answerSupportQuestion(question: string): string {
  if (question.includes("refund")) {
    return "Refunds are available for 30 days.";
  }
  if (question.includes("security")) {
    return "Security incidents must be escalated to the incident commander.";
  }
  return "Please contact support.";
}
