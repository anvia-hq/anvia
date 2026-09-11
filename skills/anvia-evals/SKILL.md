---
name: anvia-evals
description: Evaluate Anvia agents and retrieval — deterministic metrics, semantic similarity, LLM judges, RAG quality, and CLI eval runs.
---

# Anvia Evals Skill

Use this skill when the user wants to measure output quality: scoring a target
function or agent over cases, picking metrics, adding an LLM judge, checking RAG
grounding, or wiring evals into CI.

## Process

1. Start deterministic (`references/metrics.md`) — exact match, contains, semantic similarity.
2. Add judges only for what strings cannot check (`references/judges.md`).
3. Run it right (`references/running.md`) — `runEvalSuite` vs `runEvalCli`, negative controls, expectations.
4. Run `scripts/check-evals.sh` from the app root before claiming done.

## Minimal slice

```ts
import { contains, exactMatch, runEvalCli } from "@anvia/core/evals";

await runEvalCli({
  name: "support-basic-metrics",
  cases: [
    {
      id: "refund-window",
      input: "When can I request a refund?",
      expected: "Refunds are available for 30 days.",
    },
    {
      id: "wrong-refund-window",
      input: "Negative control: when can I request a refund?",
      expected: "Refunds are available for 30 days.",
    },
  ],
  target: async (input) => answerSupportQuestion(input),
  metrics: [exactMatch(), contains({ expected: ({ case: testCase }) => "30 days" })],
  expectations: {
    outcomes: { "wrong-refund-window": { exact_match: "fail", contains: "fail" } },
  },
  exitCode: true,
});
```

## Output

Every behavior claim needs a case. Prefer cheap deterministic metrics; spend
LLM-judge budget where wording varies. Point to the relevant reference file
instead of pasting its contents into chat.
