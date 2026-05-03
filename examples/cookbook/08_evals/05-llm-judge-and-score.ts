import { llmJudge, llmScore, runEvalSuite } from "@anvia/core/evals";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const openAIClient = new OpenAIClient({ apiKey: requireEnv("OPENAI_API_KEY") });
const model = openAIClient.completionModel(process.env.OPENAI_MODEL ?? "gpt-5.5");

const cases = [
  {
    id: "refund-window",
    input: "When can I request a refund?",
    expected: "The answer must say refunds are available for 30 days.",
  },
  {
    id: "billing-owner",
    input: "Who can change billing settings?",
    expected: "The answer must say workspace owners can change billing settings.",
  },
];

const result = await runEvalSuite({
  name: "support-llm-judge-score",
  cases,
  target: async (input) => answerSupportQuestion(input),
  metrics: [
    llmJudge({
      model,
      schema: z.object({
        passed: z.boolean(),
        reason: z.string(),
      }),
      passes: (judgment) => judgment.passed,
      instructions:
        "Decide whether the output satisfies the expected support policy. Return passed and a short reason.",
    }),
    llmScore({
      model,
      threshold: 0.8,
      criteria: [
        "The output answers the user's question directly.",
        "The output matches the expected support policy.",
        "The output does not add unsupported policy details.",
      ],
    }),
  ],
});

console.table(
  result.results.flatMap((caseResult) =>
    caseResult.metrics.map((metric) => ({
      case: caseResult.case.id,
      metric: metric.metricName,
      outcome: metric.outcome.outcome,
      score: scoreForTable(metric.outcome.score),
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

function scoreForTable(score: unknown): string | number | boolean {
  if (typeof score === "number" || typeof score === "boolean") {
    return score;
  }
  if (typeof score === "object" && score !== null && "score" in score) {
    const nested = score as { score?: unknown };
    return typeof nested.score === "number" ? nested.score : "";
  }
  return "";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Set ${name} before running this cookbook example.`);
  }
  return value;
}
