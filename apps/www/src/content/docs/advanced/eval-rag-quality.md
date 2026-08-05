---
title: Evaluating RAG quality
description: Separate retrieval failures from answer grounding, relevance, and hallucination failures.
section: advanced
sidebar:
  group: Quality and operations
  order: 53
---

A RAG eval should tell you whether retrieval found useful evidence and whether generation used that
evidence correctly. A single "answer quality" score cannot reliably distinguish those failures.

Anvia gives each case two reference channels:

- `context` is trusted ground truth used by `hallucination(...)`.
- `retrievalContext` is what the retriever actually returned and is used by `faithfulness(...)`.

Do not copy the same chunks into both fields by default. If retrieval returns the wrong fact and the
answer repeats it faithfully, that is a retrieval failure—not a generation-grounding success you
want to mistake for correctness.

## Measure The Layers Separately

| Layer | Question | Suggested metric |
| --- | --- | --- |
| Retrieval selection | Did search return the expected documents or facts? | Deterministic custom metric over ids, metadata, or chunks |
| Grounding | Are answer claims supported by retrieved chunks? | `faithfulness(...)` |
| Trusted correctness | Does the answer contradict known truth? | `hallucination(...)` |
| User relevance | Does the answer address the question? | `answerRelevancy(...)` |
| Task-specific quality | Does it satisfy the product rubric? | `gEval(...)` |

Evaluate retrieval before generation when possible. That makes chunking, filters, ranking, and
answer synthesis independently debuggable.

## Build Cases With Evidence

```ts
import type { EvalCase } from "@anvia/core/evals";

type RagInput = {
  question: string;
};

type RagExpected = {
  answer: string;
  documentIds: string[];
};

const cases = [
  {
    id: "refund-window",
    input: { question: "How long do I have to request a refund?" },
    expected: {
      answer: "Customers have 30 days to request a refund.",
      documentIds: ["refund-policy"],
    },
    context: ["Refund requests are accepted for 30 days."],
    metadata: { policyVersion: "2026-08" },
  },
] satisfies Array<EvalCase<RagInput, RagExpected>>;
```

Keep trusted truth concise and authoritative. Include adversarial cases where documents are absent,
outdated, tenant-filtered, or mutually similar; easy positive cases alone will not expose retrieval
regressions.

## Return Retrieval Evidence

Make the target expose both its answer and the chunks selected during the real product flow:

```ts
type RagOutput = {
  answer: string;
  documentIds: string[];
  chunks: string[];
};

async function ragTarget(input: RagInput): Promise<RagOutput> {
  const results = await docsIndex.search({ query: input.question, topK: 4 });
  const chunks = results.map((result) => String(result.document));
  const answer = await answerFromContext(input.question, chunks);

  return {
    answer,
    chunks,
    documentIds: results.map((result) => result.id),
  };
}
```

The suite can select `output.chunks` as the faithfulness reference. This is useful when retrieved
context is known only after the target runs:

```ts
import {
  answerRelevancy,
  faithfulness,
  hallucination,
  runEvalSuite,
} from "@anvia/core/evals";

const result = await runEvalSuite({
  name: "refund-rag-quality",
  cases,
  target: ragTarget,
  metrics: [
    answerRelevancy({
      model: judgeModel,
      actual: ({ output }) => output.answer,
      threshold: 0.8,
    }),
    faithfulness({
      model: judgeModel,
      actual: ({ output }) => output.answer,
      retrievalContext: ({ output }) => output.chunks,
      threshold: 0.9,
    }),
    hallucination({
      model: judgeModel,
      actual: ({ output }) => output.answer,
      threshold: 0.1,
    }),
  ],
});
```

When every case already contains the retrieved chunks, omit the selector and set
`case.retrievalContext` instead.

## Check Retrieval Deterministically

Use document ids or stable source metadata when the expected source is known:

```ts
import { defineMetric, EvalOutcome } from "@anvia/core/evals";

const retrievedExpectedDocument = defineMetric<
  RagInput,
  RagOutput,
  number,
  RagExpected
>({
  name: "retrieval_recall",
  dataType: "NUMERIC",
  evaluate({ case: testCase, output }) {
    const expectedIds = testCase.expected?.documentIds;

    if (expectedIds === undefined || expectedIds.length === 0) {
      return EvalOutcome.invalid("Expected document ids are missing.");
    }

    const matched = expectedIds.filter((id) => output.documentIds.includes(id));
    const score = matched.length / expectedIds.length;

    return score === 1
      ? EvalOutcome.pass(score)
      : EvalOutcome.fail(score, { comment: `Retrieved ${matched.length}/${expectedIds.length}.` });
  },
});
```

This check is intentionally independent of the judge. If document identity is not stable, compare
expected facts or metadata instead.

## Interpret Combined Results

| Retrieval | Faithfulness | Trusted correctness | Likely diagnosis |
| --- | --- | --- | --- |
| Good | Good | Good | Healthy RAG path |
| Poor | Good | Poor | Answer faithfully repeated bad or stale retrieval |
| Good | Poor | Poor | Generation ignored or distorted useful evidence |
| Poor | Poor | Poor | Debug retrieval first, then generation |
| Good | Good | Poor | Trusted context or source version may disagree with retrieved content |

`hallucination(...)` is lower-is-better. Its score is the fraction of trusted context verdicts that
contradict the answer. `faithfulness(...)` is higher-is-better and scores answer claims supported by
retrieved truths. Set `penalizeAmbiguousClaims: true` when unsupported or unclear claims should count
against faithfulness.

For the runtime side of retrieval, see [RAG context](/docs/advanced/rag-context). For all metric
options, see the [core eval reference](/docs/packages/core/reference/evals).
