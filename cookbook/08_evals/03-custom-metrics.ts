import {
  contains,
  createEvalTypes,
  defineEvalSuite,
  EvalOutcome,
  printEvalResult,
  runEvalSuite,
} from "@anvia/core/evals";

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

const supportEvals = createEvalTypes<string, string, string | undefined>();

const suite = defineEvalSuite({
  name: "support-custom-metrics",
  cases,
  target: async (input) => answerSupportQuestion(input),
  metrics: [
    contains({
      expected: ({ case: testCase }) =>
        typeof testCase.expected === "string" ? testCase.expected : "",
    }),
    supportEvals.predicate(
      "no_support_handoff",
      ({ output }) => !output.includes("contact support"),
      { comment: "Answer fell back to support handoff." },
    ),
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
printEvalResult(result);

function answerSupportQuestion(question: string): string {
  if (question.includes("refund")) {
    return "Refunds are available for 30 days.";
  }

  if (question.includes("security")) {
    return "Security incidents must be escalated to the incident commander.";
  }

  return "Please contact support.";
}
