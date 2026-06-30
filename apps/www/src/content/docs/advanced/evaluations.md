---
title: Evaluations
description: Build eval suites, metrics, judges, and regression checks.
section: advanced
sidebar:
  group: Quality and operations
  order: 51
---

Evals are repeatable checks for behavior that depends on model output, retrieval quality, prompt changes, or tool choice. They complement unit tests. They do not replace tests for app-owned policy.

Use unit tests for deterministic boundaries first: tools, services, filters, runners, storage, and error mapping. Use evals for the behavior that is intentionally model-dependent.

## Run A Suite

```ts
import { contains, exactMatch, runEvalSuite } from "@anvia/core/evals";

const cases = [
  {
    id: "refund-window",
    input: "When can I request a refund?",
    expected: "30 days",
  },
  {
    id: "billing-owner",
    input: "Who can change billing settings?",
    expected: "Workspace owners",
  },
];

const result = await runEvalSuite({
  name: "support-policy-regression",
  cases,
  target: async (input) => answerSupportQuestion(input),
  metrics: [
    contains(),
    exactMatch({
      name: "not_blank",
      actual: ({ output }) => output.trim().length > 0,
      expected: true,
    }),
  ],
});

runtimeLog.info({
  passed: result.passed,
  failed: result.failed,
  invalid: result.invalid,
});
```

Cases should be small, named, and tied to one behavior. Put broad scenarios into multiple cases so failures are useful.

## Agent Targets

Use `agentEvalTarget(...)` when the target is an agent request:

```ts
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import type { PromptResponse } from "@anvia/core/request";

const result = await runEvalSuite({
  name: "support-agent-answer-quality",
  cases,
  target: agentEvalTarget<string>(supportAgent),
  metrics: [
    contains<string, PromptResponse, string>({
      actual: ({ output }) => output.output,
    }),
  ],
});
```

Use a custom target when the product behavior lives in a runner. That lets the eval include scoped tools, retrieval, memory, trace metadata, and response mapping.

## Metric Types

Core includes deterministic and model-backed metrics:

- `exactMatch(...)` for labels, booleans, ids, and exact objects
- `contains(...)` for required facts, substrings, or regular expressions
- `semanticSimilarity(...)` for answers where wording may vary
- `llmJudge(...)` for schema-shaped rubric judgments
- `llmScore(...)` for scored feedback with a threshold

Start deterministic. Add LLM judges only when simple selectors cannot express the behavior.

## Custom Metrics

Use `defineMetric(...)` or a plain metric object:

```ts
import { EvalOutcome, defineMetric } from "@anvia/core/evals";

const noHandoffMetric = defineMetric({
  name: "no_support_handoff",
  evaluate({ output }) {
    return output.includes("contact support")
      ? EvalOutcome.fail(false, { comment: "Answer fell back to support handoff." })
      : EvalOutcome.pass(true);
  },
});
```

Return `invalid(...)` when the case cannot be judged, for example because expected data is missing or the target failed.

## Concurrency And Reporters

```ts
const result = await runEvalSuite({
  name: "support-regression",
  cases,
  target,
  metrics,
  concurrency: 3,
  reporters: [evalReporter],
});
```

Concurrency preserves result order. Reporters receive each metric outcome and can send scores to an external system.

Reporter failures are captured on each metric result by default. Set `failOnReporterError: true` only when reporting must fail the job.

## LLM Judges

```ts
import { llmJudge, runEvalSuite } from "@anvia/core/evals";
import { z } from "zod";

const policyJudge = llmJudge({
  model: judgeModel,
  schema: z.object({
    passed: z.boolean(),
    reason: z.string(),
  }),
  passes: (judgment) => judgment.passed,
  instructions: "Decide whether the answer follows the expected support policy.",
});
```

LLM judges use extractors internally. Keep judge prompts narrow and store judge feedback so failures are explainable.

## What To Evaluate

Good evals usually cover:

- stable policy facts
- tool choice for known prompts
- retrieval answer quality
- refusal or escalation behavior
- structured output fields
- regressions from real incidents

Do not use evals for permission checks that can be proven with direct tool or service tests.
