import {
  compareEvalTargets,
  contains,
  createMemoryEvalCache,
  notBlank,
  printEvalComparison,
  printEvalResult,
} from "@anvia/core/evals";

const cases = [
  {
    id: "refund-window",
    input: "When can I request a refund?",
    expected: "30 days",
    tags: ["billing"],
  },
  {
    id: "billing-owner",
    input: "Who can change billing settings?",
    expected: "Workspace owners",
    tags: ["billing"],
  },
];

const comparison = await compareEvalTargets({
  name: "support-prompt-comparison",
  cases,
  targets: {
    baseline: async (input) =>
      input.includes("refund") ? "Refunds take 14 days." : "Contact support.",
    candidate: async (input) =>
      input.includes("refund")
        ? "Refunds are available for 30 days."
        : "Workspace owners can change billing settings.",
  },
  metrics: [notBlank(), contains({ caseSensitive: false })],
  trials: { count: 2, minPassRate: 1 },
  targetCache: createMemoryEvalCache(),
});

for (const result of Object.values(comparison.results)) {
  printEvalResult(result);
}

for (const diff of Object.values(comparison.comparisons)) {
  printEvalComparison(diff);
}
