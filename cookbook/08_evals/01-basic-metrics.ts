import { contains, exactMatch, runEvalCli } from "@anvia/core/evals";

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
  {
    id: "wrong-refund-window",
    input: "Negative control: when can I request a refund?",
    expected: "Refunds are available for 30 days.",
  },
];

await runEvalCli({
  name: "support-basic-metrics",
  cases,
  target: async (input) => answerSupportQuestion(input),
  metrics: [
    exactMatch(),
    contains({
      expected: ({ case: testCase }) =>
        testCase.id === "billing-owner" ? "Workspace owners" : "30 days",
    }),
  ],
  expectations: {
    outcomes: {
      "wrong-refund-window": {
        exact_match: "fail",
        contains: "fail",
      },
    },
  },
  exitCode: true,
});

function answerSupportQuestion(question: string): string {
  if (question.includes("Negative control")) {
    return "Refunds are available for 90 days.";
  }
  if (question.includes("refund")) {
    return "Refunds are available for 30 days.";
  }
  if (question.includes("billing")) {
    return "Workspace owners can change billing settings.";
  }
  return "Please contact support.";
}
