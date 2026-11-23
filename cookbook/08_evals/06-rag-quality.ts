import { createJudgeMetrics, printEvalResult, runEvalSuite } from "@anvia/core/evals";
import { OpenAIClient } from "@anvia/openai";

const openAIClient = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const judgeModel = openAIClient.completionModel({ modelId: "gpt-5.5", api: "responses" });
const judge = createJudgeMetrics({ model: judgeModel, includeReason: "on-fail" });

const result = await runEvalSuite({
  name: "refund-rag-quality",
  cases: [
    {
      id: "refund-window",
      input: "How long do I have to request a refund?",
      expected: "Customers have 30 days to request a refund.",
      context: ["Refund requests are accepted for 30 days."],
      retrievalContext: ["Customers may request a refund within 30 days."],
    },
  ],
  target: async () => "Customers can request a refund within 30 days.",
  metrics: [
    judge.answerRelevancy({ threshold: 0.8 }),
    judge.faithfulness({ threshold: 0.8 }),
    judge.hallucination({ threshold: 0.1 }),
    judge.gEval({
      name: "correctness",
      evaluationParams: ["actualOutput", "expectedOutput"],
      evaluationSteps: [
        "Check whether the answer preserves the expected refund window.",
        "Allow different wording when the policy meaning is unchanged.",
      ],
      threshold: 0.8,
    }),
  ],
});

printEvalResult(result);
