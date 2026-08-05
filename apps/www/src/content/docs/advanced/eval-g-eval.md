---
title: G-Eval and custom rubrics
description: Build repeatable task-specific quality scores with criteria, explicit steps, and score rubrics.
section: advanced
sidebar:
  group: Quality and operations
  order: 54
---

G-Eval is useful when quality depends on several related judgments that do not fit a built-in
metric. It turns criteria or explicit evaluation steps into one normalized score and an
evidence-based explanation.

Use it for product-specific qualities such as policy correctness, escalation quality, citation
style, diagnostic usefulness, or tone. Prefer deterministic metrics for facts that application code
can prove directly.

## Start With Explicit Steps

Explicit steps make the rubric easy to review and stable across runs:

```ts
import { gEval } from "@anvia/core/evals";

const supportCorrectness = gEval({
  name: "support_correctness",
  model: judgeModel,
  evaluationParams: ["input", "actualOutput", "expectedOutput"],
  evaluationSteps: [
    "Identify the policy facts required by the expected output.",
    "Check whether the actual output preserves every required fact.",
    "Penalize contradictions more heavily than omitted detail.",
    "Do not require identical wording.",
  ],
  threshold: 0.8,
});
```

The judge returns a raw score, normally from 0 through 10. Anvia normalizes that score to 0–1 before
applying the threshold. The raw score, range, rubric, and evaluation steps are retained in
`outcome.metadata.evaluation`.

## Choose Evaluation Parameters

`evaluationParams` controls exactly what evidence the judge receives:

| Parameter | Value |
| --- | --- |
| `input` | Case input, formatted as text unless selected explicitly |
| `actualOutput` | Target output, formatted as text unless selected explicitly |
| `expectedOutput` | `case.expected` or an `expected` selector |
| `context` | Trusted case context or a selector |
| `retrievalContext` | Retrieved case context or a selector |
| `metadata` | Case metadata |

Only include evidence needed by the rubric. Extra context can distract the judge and make the score
harder to explain.

For structured target output, select the exact fields you want graded:

```ts
type RagOutput = {
  answer: string;
  chunks: string[];
};

const citationQuality = gEval<unknown, RagOutput>({
  name: "citation_quality",
  model: judgeModel,
  evaluationParams: ["actualOutput", "context"],
  actual: ({ output }) => output.answer,
  context: ({ output }) => output.chunks,
  evaluationSteps: [
    "Check that factual claims have a nearby citation.",
    "Check that each citation points to context supporting the claim.",
  ],
  threshold: 0.8,
});
```

## Generate Steps From Criteria

For quick experiments, provide `criteria` instead of `evaluationSteps`:

```ts
const helpfulness = gEval({
  name: "helpfulness",
  model: judgeModel,
  evaluationParams: ["input", "actualOutput"],
  criteria:
    "The answer should directly solve the user's request, explain necessary actions, and avoid irrelevant detail.",
  threshold: 0.7,
});
```

Provide exactly one of `criteria` or `evaluationSteps`. Generated steps are cached on the metric
instance, so cases in the same suite use the same steps. Explicit steps are still preferable for
reviewed regression gates because they keep the grading procedure in source control.

## Add A Score Rubric

A rubric gives score bands concrete meanings:

```ts
const policyQuality = gEval({
  name: "policy_quality",
  model: judgeModel,
  evaluationParams: ["actualOutput", "expectedOutput"],
  evaluationSteps: [
    "Compare the actual policy claims with the expected policy.",
    "Assign a score using the supplied rubric.",
  ],
  rubric: [
    { scoreRange: [0, 2], expectedOutcome: "Contradicts the policy or invents an action." },
    { scoreRange: [3, 6], expectedOutcome: "Partially correct but misses an important condition." },
    { scoreRange: [7, 8], expectedOutcome: "Correct with only minor omissions." },
    { scoreRange: [9, 10], expectedOutcome: "Fully correct, direct, and complete." },
  ],
  threshold: 0.8,
});
```

Rubric ranges must contain ordered integers from 0 through 10 and must not overlap. Gaps are
allowed, but every reachable score should have a clear interpretation. The outer rubric range
becomes the normalization range.

## Strict Mode And Reasons

With `strictMode: true`, G-Eval asks the judge for `1` only when the output completely complies and
`0` otherwise. Use strict mode for binary release requirements, not for qualities that naturally
vary by degree.

The judge always returns a reason as part of its structured result. `includeReason: false` keeps it
out of `outcome.comment`; score evidence and usage remain available in metadata.

```ts
const metricResult = result.results[0]?.metrics.find(
  (metric) => metric.metricName === "policy_quality",
);

if (metricResult?.outcome.outcome !== "invalid") {
  console.log(metricResult?.outcome.score);
  console.log(metricResult?.outcome.comment);
  console.dir(metricResult?.outcome.metadata?.evaluation, { depth: null });
}
```

## Make Rubrics Reliable

- Give each metric one named quality instead of combining unrelated goals.
- Write observable steps: "check whether" is easier to grade than "be excellent."
- State how to treat omissions, contradictions, and acceptable wording differences.
- Include expected output only when a reference answer is meaningful.
- Test the rubric against obvious good, borderline, and bad examples.
- Review disagreement between human labels and judge scores before enforcing a threshold.
- Recalibrate when the judge model or rubric changes.

For simpler custom judgments, compare `llmJudge(...)` and `llmScore(...)` in
[Choosing eval metrics](/docs/advanced/eval-metrics). Exact G-Eval types are in the
[core eval reference](/docs/packages/core/reference/evals).
