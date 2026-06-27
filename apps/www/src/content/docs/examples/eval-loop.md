---
title: Eval Loop
description: A pattern for regression checks over prompts, retrieval, tools, and workflows.
section: examples
sidebar:
  group: Quality and Operations
  order: 3
---

Eval loops turn expected product behavior into repeatable checks. Run evals against the same runner boundary used in production so they include scoped tools, retrieval filters, trace metadata, and response mapping.

## Scenario

Support answers must follow refund policy, call order tools when account state matters, cite retrieved policy, and avoid account data leaks.

## Flow

| Check | Best tool |
| --- | --- |
| permissions and denial paths | unit tests |
| tool choice and citations | eval cases over runner output/events |
| answer quality | deterministic metrics first, judge metrics when needed |
| regressions from incidents | named eval cases tied to release/prompt version |

## Example

```ts
import { contains, defineMetric, EvalOutcome, runEvalSuite } from "@anvia/core/evals";

const supportCases = [
  {
    id: "refund-policy-with-order",
    input: {
      conversationId: "eval_refund_1",
      message: "Can I refund order A-100?",
    },
    expected: {
      requiredText: "refund",
      expectedTool: "lookup_order",
      forbiddenText: "other customer",
    },
    metadata: {
      release: process.env.RELEASE_ID,
      promptVersion: "support-v4",
    },
  },
  {
    id: "missing-order-id",
    input: {
      conversationId: "eval_refund_2",
      message: "Can I get a refund?",
    },
    expected: {
      requiredText: "order",
      expectedTool: undefined,
      forbiddenText: "processed",
    },
  },
];

const calledExpectedTool = defineMetric({
  name: "called_expected_tool",
  evaluate({ output, expected }) {
    if (expected.expectedTool === undefined) {
      return output.toolCalls.length === 0
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: "Unexpected tool call." });
    }

    return output.toolCalls.includes(expected.expectedTool)
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: `Missing ${expected.expectedTool}.` });
  },
});

const result = await runEvalSuite({
  name: "support-regression",
  cases: supportCases,
  target: async (input) => runSupportEvalCase(input),
  metrics: [
    contains({
      actual: ({ output }) => output.answer,
      expected: ({ expected }) => expected.requiredText,
    }),
    calledExpectedTool,
  ],
  reporters: [evalReporter],
});
```

The eval target should call the product runner, not a separate prompt:

```ts
async function runSupportEvalCase(input: SupportEvalInput) {
  const events = [];

  const result = await runSupportTurn({
    ...fakeSupportInput(),
    conversationId: input.conversationId,
    message: input.message,
    onEvent: (event) => events.push(event),
  });

  return {
    answer: result.output,
    toolCalls: events
      .filter((event) => event.type === "tool_call")
      .map((event) => event.toolCall.function.name),
  };
}
```

## Failure Modes

- Eval cases call a different agent path than production.
- Expected behavior is vague, so failures are ignored.
- Tool-call expectations are not captured.
- Eval results are not connected to release or prompt version.
- LLM judges are used where deterministic checks would be clearer.

## Next Patterns

- [Testing Harness](/docs/examples/testing-harness)
- [Observability Loop](/docs/examples/observability-loop)
- [Production Readiness](/docs/examples/production-readiness)
