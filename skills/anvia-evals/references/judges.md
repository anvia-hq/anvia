# LLM Judges

Use judges when wording varies but meaning is checkable — policy compliance,
tone, grading scales. Judges need a model and explicit pass criteria.

```ts
import { llmJudge, llmScore } from "@anvia/core/evals";

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

## RAG quality metrics

Cases carry `context` and `retrievalContext`; the metrics check grounding:

```ts
import { answerRelevancy, faithfulness, hallucination, gEval } from "@anvia/core/evals";

answerRelevancy({ model: judgeModel, threshold: 0.8 });
faithfulness({ model: judgeModel, threshold: 0.8 });
hallucination({ model: judgeModel, threshold: 0.1 }); // lower is better — note the direction
gEval({
  name: "correctness",
  model: judgeModel,
  evaluationParams: ["actualOutput", "expectedOutput"],
  evaluationSteps: [
    "Check whether the answer preserves the expected refund window.",
    "Allow different wording when the policy meaning is unchanged.",
  ],
  threshold: 0.8,
});
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
- Keep judge `instructions` / `criteria` / `evaluationSteps` in the eval file
  under version control — they are part of the test, not ambient prompt text.
