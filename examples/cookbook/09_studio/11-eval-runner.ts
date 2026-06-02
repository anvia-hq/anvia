import { contains, exactMatch } from "@anvia/core/evals";
import { Studio } from "@anvia/studio";

const supportPolicyEval = {
  id: "studio-support-policy",
  name: "Studio Support Policy",
  description: "Runs a deterministic eval suite from the Studio Evals page.",
  cases: [
    {
      id: "refund-window",
      input: "When can customers request a refund?",
      expected: "Refunds are available for 30 days.",
    },
    {
      id: "billing-owner",
      input: "Who can change billing settings?",
      expected: "Workspace owners can change billing settings.",
    },
  ],
  target: async (input: string) => answerSupportPolicy(input),
  metrics: [
    exactMatch(),
    contains({
      expected: ({ case: testCase }) =>
        testCase.id === "refund-window" ? "30 days" : "Workspace owners",
    }),
  ],
};

new Studio([], {
  evals: [supportPolicyEval],
}).start({ port: 4021 });

console.log("Open http://localhost:4021/ui/evals to run the Studio Support Policy suite.");
console.log("The raw API is available at http://localhost:4021/evals/studio-support-policy/runs");

function answerSupportPolicy(question: string): string {
  if (question.includes("refund")) {
    return "Refunds are available for 30 days.";
  }
  if (question.includes("billing")) {
    return "Workspace owners can change billing settings.";
  }
  return "Please contact support.";
}
