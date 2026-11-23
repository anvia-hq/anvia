# LLM Judges

Use judges when wording varies but meaning is checkable — policy compliance,
tone, grading scales. Judges need a model and explicit pass criteria.

```ts
import { createJudgeMetrics, llmJudge, llmScore } from "@anvia/core/evals";

llmJudge({
  model,
  schema: z.object({ passed: z.boolean(), reason: z.string() }),
  passes: (judgment) => judgment.passed,
  instructions:
    "Decide whether the output satisfies the expected support policy. Return passed and a short reason.",
});
llmScore({
  model,
  threshold: 0.8,
  criteria: [
    "The output answers the user's question directly.",
    "The output matches the expected support policy.",
    "The output does not add unsupported policy details.",
  ],
});
```

`llmJudge` automatically extracts `reason` / `feedback` / `explanation` into the
outcome `comment` (or pass a custom `comment` selector).

## Shared judge config & RAG quality metrics

Use `createJudgeMetrics` to bind a shared `model`, `retries`, and
`includeReason: "on-fail"` (skips the extra explanation LLM call on passing cases):

```ts
import { createJudgeMetrics } from "@anvia/core/evals";

const judge = createJudgeMetrics({
  model: judgeModel,
  includeReason: "on-fail",
});

metrics: [
  judge.answerRelevancy({ threshold: 0.8 }),
  judge.faithfulness({ threshold: 0.8 }),
  judge.hallucination({ threshold: 0.1 }), // lower is better — note the direction
  judge.gEval({
    name: "correctness",
    evaluationParams: ["actualOutput", "expectedOutput"],
    evaluationSteps: [
      "Check whether the answer preserves the expected refund window.",
      "Allow different wording when the policy meaning is unchanged.",
    ],
    threshold: 0.8,
  }),
];
```

Related: `promptAlignment`, `jsonCorrectness`, `abstention`, `summarization` for
specialized outputs; `turnRelevancy` and `knowledgeRetention` for conversations
(see the cookbook's conversation-quality example).

## Rules

- Pin the judge model (`modelId`) — a silently upgraded judge re-grades history.
- Prefer a different (usually stronger) model for judging than for generating;
  self-judging inflates scores.
- `threshold` direction matters: most metrics pass at/above it, `hallucination`
  passes at/below it.
- Use `includeReason: "on-fail"` on large suites to avoid paying for explanation
  calls on passing cases.
- Keep judge `instructions` / `criteria` / `evaluationSteps` in the eval file
  under version control — they are part of the test, not ambient prompt text.
