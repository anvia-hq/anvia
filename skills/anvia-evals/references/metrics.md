# Deterministic Metrics

All metrics come from `@anvia/core/evals`. Metrics compare the target `output`
against the case `expected` and report `pass | fail | invalid` with scores and
comments. Start here — they cost nothing and never flake.

```ts
import {
  contains,
  exactMatch,
  matches,
  notBlank,
  notContains,
  predicate,
  semanticSimilarity,
} from "@anvia/core/evals";

metrics: [
  exactMatch(), // deep-equal to expected — supports { caseSensitive, trim }
  contains("30 days"), // shorthand or options object ({ expected, caseSensitive })
  notContains("90 days"), // forbid known-bad phrases
  matches(/^\d+ days$/), // regex shape checks
  notBlank(), // catch empty agent outputs
  semanticSimilarity({ model: embeddingModel, threshold: 0.8 }), // embedding closeness, no judge LLM needed
  predicate("no_handoff", ({ output }) => !String(output).includes("contact support")),
];
```

- `expected` (and `actual`) accept selector functions over
  `{ suiteName, case, output, signal, targetDurationMs }` — reach per-case metadata
  as `case.metadata`. Use them to vary expectations per case instead of writing one
  metric per case.
- `containsAll` / `containsAny` check multi-fragment outputs (accept positional arrays
  or zero-arg implicit `case.expected`); `maxLength`, `requiredFields`, and
  `schemaMatch(zodSchema)` guard shape for structured outputs.
- `defineMetric` and `createEvalTypes<Input, Output, Expected>().predicate(...)`
  build typed custom metrics when nothing fits — keep metrics pure so results stay
  reproducible.

## Agent outputs & trajectory metrics

Built-in text metrics automatically unwrap `AgentResponse.output`, and agent
metrics inspect `AgentResponse.messages`, `usage`, and target latency directly:

```ts
import {
  agentEvalTarget,
  contains,
  maxDurationMs,
  maxTokens,
  maxTurns,
  notBlank,
  toolCalled,
  toolCallOrder,
  toolNotCalled,
} from "@anvia/core/evals";

target: agentEvalTarget(agent),
metrics: [
  notBlank(),
  contains(),
  toolCalled("search_policy", { args: { topic: "refund" } }),
  toolNotCalled("delete_account"),
  toolCallOrder(["search_policy", "reply"]),
  maxTurns(3),
  maxTokens(2000),
  maxDurationMs(5000),
];
```

Always include `notBlank()` for agent targets — an empty output passing every
negative content metric is the classic false green.
