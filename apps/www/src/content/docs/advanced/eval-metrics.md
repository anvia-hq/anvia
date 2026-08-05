---
title: Choosing eval metrics
description: Match deterministic checks, semantic comparison, and model judges to the behavior you need to measure.
section: advanced
sidebar:
  group: Quality and operations
  order: 52
---

An eval metric should answer one narrow question. The best metric is usually the least subjective
one that can prove the behavior you care about.

Start with exact values and schemas. Add semantic or model-graded checks only when correct answers
can vary in ways that deterministic code cannot describe.

## Choose By Behavior

| Behavior | Start with | Why |
| --- | --- | --- |
| Exact labels, ids, booleans, or objects | `exactMatch(...)` | Fast and deterministic |
| Required text or a regular expression | `contains(...)` | Easy to interpret when it fails |
| Valid JSON with a known shape | `jsonCorrectness(...)` | Parses and validates against Zod without a judge |
| Equivalent answers with different wording | `semanticSimilarity(...)` | Compares embeddings instead of exact text |
| Answer stays on topic | `answerRelevancy(...)` | Judges each substantive answer statement |
| Answer follows explicit instructions | `promptAlignment(...)` | Scores each instruction independently |
| Summary is grounded and complete | `summarization(...)` | Combines factual alignment with source coverage |
| One custom pass/fail judgment | `llmJudge(...)` | Returns your own structured judgment |
| One custom numeric criterion | `llmScore(...)` | Produces scored feedback against a threshold |
| A reusable multi-step rubric | `gEval(...)` | Normalizes a task-specific rubric to a 0–1 score |

For retrieval-grounded answers, see [Evaluating RAG quality](/docs/advanced/eval-rag-quality).
For multi-turn output, see [Evaluating conversations](/docs/advanced/eval-conversations).

## Use A Deterministic Base

Structured output is easiest to evaluate by selecting the field that carries the behavior:

```ts
import { contains, exactMatch, runEvalSuite } from "@anvia/core/evals";

type TicketResult = {
  category: "billing" | "shipping" | "other";
  reply: string;
};

await runEvalSuite({
  name: "ticket-routing",
  cases: [
    {
      id: "invoice-copy",
      input: "Where can I download an invoice?",
      expected: { category: "billing", phrase: "Billing" },
    },
  ],
  target: classifyAndReply,
  metrics: [
    exactMatch({
      name: "category",
      actual: ({ output }) => output.category,
      expected: ({ case: testCase }) => testCase.expected?.category,
    }),
    contains({
      name: "required_phrase",
      actual: ({ output }) => output.reply,
      expected: ({ case: testCase }) => testCase.expected?.phrase,
    }),
  ],
});
```

Selectors let the target return a useful product-level object instead of flattening everything to
text for the eval runner.

## Add Specialized Judges

Use specialized metrics when the failure has a stable meaning:

```ts
import {
  answerRelevancy,
  promptAlignment,
  runEvalSuite,
} from "@anvia/core/evals";

await runEvalSuite({
  name: "concise-support-answers",
  cases,
  target: answerSupportQuestion,
  metrics: [
    answerRelevancy({ model: judgeModel, threshold: 0.8 }),
    promptAlignment({
      model: judgeModel,
      promptInstructions: [
        "Answer the user's question directly.",
        "Do not claim that an action was completed.",
      ],
      threshold: 1,
    }),
  ],
});
```

`answerRelevancy` decomposes the answer into statements and scores how many are relevant.
`promptAlignment` returns one verdict per supplied instruction. Keep those instructions atomic: one
requirement per array item produces more useful failures.

## Evaluate JSON Without A Judge

`jsonCorrectness(...)` parses the target text and validates it against a Zod schema:

```ts
import { jsonCorrectness } from "@anvia/core/evals";
import { z } from "zod";

const validTicketJson = jsonCorrectness({
  schema: z.object({
    category: z.enum(["billing", "shipping", "other"]),
    confidence: z.number().min(0).max(1),
  }),
});
```

Valid output scores `1`; malformed JSON or a schema mismatch scores `0`. A model is optional and is
used only to explain invalid output when `includeReason` is enabled. It does not decide whether the
JSON is correct.

## Understand Outcomes

Model-backed metrics return a numeric score. Most are higher-is-better and pass when the score is
at least `threshold`. `hallucination(...)` is the exception: lower is better, and it passes at or
below the threshold.

`strictMode: true` means only a perfect result passes. For higher-is-better metrics that means `1`;
for hallucination it means `0`.

```ts
const outcome = result.results[0]?.metrics[0]?.outcome;

if (outcome?.outcome === "invalid") {
  console.error(outcome.reason);
} else {
  console.log(outcome?.score, outcome?.comment);
  console.dir(outcome?.metadata?.evaluation, { depth: null });
}
```

`fail` means the metric ran and the output missed the threshold. `invalid` means the case could not
be judged, for example because required reference data was missing, the target failed, or the judge
returned an unusable structure. Track invalid results separately; treating them as ordinary quality
failures can hide broken eval infrastructure.

Judge explanations live in `outcome.comment`. Intermediate statements, verdicts, score breakdowns,
and aggregate token usage live under `outcome.metadata.evaluation`.

## Control Cost And Variance

Specialized metrics can make multiple model calls per case. Keep a fast regression layer with
deterministic metrics, then run judge-heavy suites on a smaller representative dataset.

- Set `includeReason: false` when intermediate verdicts are enough.
- Use a stable judge model and pin its configuration.
- Keep case inputs and grading instructions focused.
- Use explicit G-Eval steps when repeatability matters more than convenience.
- Review score distributions before choosing a threshold.
- Recalibrate after changing the judge model, rubric, or dataset.

For exact option and return types, see the [core eval reference](/docs/packages/core/reference/evals).
