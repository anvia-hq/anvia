# Deterministic Metrics

All metrics come from `@anvia/core/evals`. Metrics compare the target `output`
against the case `expected` and report `pass | fail | invalid` with scores and
comments. Start here — they cost nothing and never flake.

```ts
import { contains, exactMatch, notContains, matches, semanticSimilarity } from "@anvia/core/evals";

metrics: [
  exactMatch(), // deep-equal to expected — structurally equal objects/arrays pass
  contains({
    expected: ({ case: testCase }) =>
      testCase.id === "billing-owner" ? "Workspace owners" : "30 days",
  }),
  notContains({ expected: "90 days" }), // forbid known-bad phrases
  matches({ expected: /^\d+ days$/ }), // regex shape checks
  semanticSimilarity({ model: embeddingModel, threshold: 0.8 }), // embedding closeness, no judge LLM needed
];
```

- `expected` (and `actual`) accept selector functions over
  `{ suiteName, case, output, signal }` — reach per-case metadata as
  `case.metadata`. Use them to vary expectations per case instead of writing one
  metric per case.
- `containsAll` / `containsAny` check multi-fragment outputs; `maxLength` and
  `requiredFields` guard shape for structured outputs.
- `defineMetric` builds custom metrics when nothing fits — keep the metric pure
  (input, output, expected in; outcome out) so results stay reproducible.

## Agent outputs

Metrics work over any target output. For agents, project the response first:

```ts
contains<string, AgentResponse, string>({ actual: ({ output }) => output.output });
exactMatch<string, AgentResponse, string>({
  name: "not_blank",
  actual: ({ output }) => output.output.trim().length > 0,
  expected: true,
});
```

Always include a not-blank style metric for agent targets — an empty output
passing every content metric is the classic false green.
