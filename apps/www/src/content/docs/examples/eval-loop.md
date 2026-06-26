---
title: Eval Loop
description: The pattern for regression checks over prompts, tools, and workflows.
section: examples
sidebar:
  group: Quality and Operations
  order: 3
---

Eval loops turn expected product behavior into repeatable checks. They should run against a stable runner boundary, not scattered prompt calls.

## Scenario

Support answers must follow refund policy and avoid account data leaks.

## Example

```ts
const supportCases = [
  {
    name: "refund-policy-with-order",
    input: "Can I refund order A-100?",
    expected: {
      mentionsPolicy: true,
      callsOrderTool: true,
      leaksOtherTenant: false,
    },
  },
  {
    name: "missing-order-id",
    input: "Can I get a refund?",
    expected: {
      asksClarifyingQuestion: true,
      callsOrderTool: false,
    },
  },
];

for (const testCase of supportCases) {
  const result = await runSupportTurn(fakeSupportInput(testCase.input));
  await evalReporter.record({
    caseName: testCase.name,
    output: result.ok ? result.output : result.error,
    scores: await scoreSupportOutput(result, testCase.expected),
  });
}
```

## Failure Modes

- Eval cases call a different agent path than production.
- Expected behavior is vague, so failures are ignored.
- Tool-call expectations are not captured.
- Eval results are not connected to release or prompt version.

## Next Patterns

- [Testing Harness](/docs/examples/testing-harness)
- [Observability Loop](/docs/examples/observability-loop)
