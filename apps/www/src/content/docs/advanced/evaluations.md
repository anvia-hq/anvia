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

## Read By Goal

This page explains the eval loop: cases, targets, metrics, outcomes, concurrency, and reporters.
Continue with the focused guide for the quality you need to measure:

| Goal | Guide |
| --- | --- |
| Decide between deterministic, semantic, and judge-backed checks | [Choosing eval metrics](/docs/advanced/eval-metrics) |
| Separate retrieval quality from grounded answer quality | [Evaluating RAG quality](/docs/advanced/eval-rag-quality) |
| Design a product-specific score and rubric | [G-Eval and custom rubrics](/docs/advanced/eval-g-eval) |
| Check relevance and memory across multiple turns | [Evaluating conversations](/docs/advanced/eval-conversations) |

Use the [core eval reference](/docs/packages/core/reference/evals) when you need exact types and
options.

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

Core includes deterministic comparisons, embedding similarity, general LLM judges, and specialized
metrics for answer, retrieval, rubric, and conversation quality. Start deterministic. Add a judge
only when simple selectors cannot express the behavior.

See [Choosing eval metrics](/docs/advanced/eval-metrics) for the decision table and scoring
semantics.

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

Reporters receive the trace reference resolved from `output.trace`, `case.input.trace`, or case
metadata. Use the same eval suite with either observability adapter:

```ts
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { createOtelEvalReporter } from "@anvia/otel";

const reporters = [
  createLangfuseEvalReporter(langfuseTracing, { onMissingTrace: "warn" }),
  createOtelEvalReporter({ onMissingTrace: "warn" }),
];
```

Langfuse stores native trace/observation scores. The OTEL adapter emits
`gen_ai.evaluation.result` events and correlates them with the evaluated span when both trace and
observation ids are available. Context payloads and metadata are opt-in or configurable because
they may contain retrieved or user-provided data.

Concurrency preserves result order. Reporters receive each metric outcome and can send scores to an external system.

Reporter failures are captured on each metric result by default. Set `failOnReporterError: true` only when reporting must fail the job.

## What To Evaluate

Good evals usually cover:

- stable policy facts
- tool choice for known prompts
- retrieval answer quality
- refusal or escalation behavior
- structured output fields
- regressions from real incidents

Do not use evals for permission checks that can be proven with direct tool or service tests.
