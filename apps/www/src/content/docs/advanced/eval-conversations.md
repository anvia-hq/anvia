---
title: Evaluating conversations
description: Measure turn relevance and knowledge retention across multi-turn user and assistant messages.
section: advanced
sidebar:
  group: Quality and operations
  order: 55
---

Conversation evals measure behavior that only becomes visible across turns. A reply can be locally
relevant and still forget a name, repeat a question, contradict an earlier constraint, or drift away
from the user's goal.

Anvia includes two conversational metrics:

- `turnRelevancy(...)` checks whether each assistant interaction is relevant to recent context.
- `knowledgeRetention(...)` checks whether later assistant replies preserve facts supplied by users.

Use them together with deterministic checks for tool calls, permissions, handoffs, and other product
events that a text-only judge cannot see.

## Supported Conversation Shapes

Without a selector, both metrics accept:

- `EvalTurn[]`
- Anvia `Message[]`
- An output such as `PromptResponse` with a `messages` array

The normalized turn shape is intentionally small:

```ts
import type { EvalMetadata } from "@anvia/core/evals";

type EvalTurn = {
  role: "user" | "assistant";
  content: string;
  metadata?: EvalMetadata;
};
```

Only text from user and assistant messages is evaluated. System messages, tool messages, images,
documents, and other non-text parts are ignored. Add separate deterministic metrics when those
parts affect correctness.

## Evaluate A Transcript

```ts
import {
  knowledgeRetention,
  runEvalSuite,
  turnRelevancy,
} from "@anvia/core/evals";

const result = await runEvalSuite({
  name: "support-conversation-quality",
  cases: [{ id: "remember-name", input: "Remember the user's name." }],
  target: async () => [
    { role: "user" as const, content: "My name is Ada." },
    { role: "assistant" as const, content: "Hello Ada." },
    { role: "user" as const, content: "What name did I give you?" },
    { role: "assistant" as const, content: "Your name is Ada." },
  ],
  metrics: [
    turnRelevancy({ model: judgeModel, threshold: 0.8 }),
    knowledgeRetention({ model: judgeModel, threshold: 0.9 }),
  ],
});
```

Each result includes per-interaction verdicts under `outcome.metadata.evaluation`. When
`includeReason` is enabled, a final explanation is also stored in `outcome.comment`.

## Turn Relevancy

Turn relevancy groups the transcript into user-to-assistant interactions. For each interaction, it
judges the final assistant reply against a sliding window of recent interactions.

```ts
const relevance = turnRelevancy({
  model: judgeModel,
  threshold: 0.8,
  windowSize: 6,
});
```

`windowSize` counts interactions, not individual messages. A smaller window reduces prompt size and
focuses on local coherence. A larger window helps when users refer back to earlier goals, but it can
increase judge cost and add irrelevant history.

The score is the fraction of assistant interactions judged relevant. Empty or incomplete
interactions are not graded as complete user-to-assistant exchanges.

## Knowledge Retention

Knowledge retention first extracts durable facts newly supplied in user turns. It then checks later
assistant replies for attrition: forgetting, contradicting, or unnecessarily asking again for known
information.

```ts
const retention = knowledgeRetention({
  model: judgeModel,
  strictMode: true,
});
```

`strictMode: true` ignores `threshold` and passes only a perfect score. For threshold-based
scoring, omit strict mode and set the threshold explicitly:

```ts
const retention = knowledgeRetention({
  model: judgeModel,
  threshold: 0.9,
});
```

The score is the fraction of checked assistant replies without knowledge attrition. If the
conversation contains no durable user facts to check, the metric scores `1`; include cases with
explicit names, preferences, constraints, or prior decisions when retention is the behavior under
test.

## Evaluate An Agent Response

`agentEvalTarget(...)` returns a full `PromptResponse` by default. Conversational metrics can read
its `messages` directly:

```ts
import {
  agentEvalTarget,
  knowledgeRetention,
  runEvalSuite,
  turnRelevancy,
} from "@anvia/core/evals";

await runEvalSuite({
  name: "account-agent-conversations",
  cases: conversationCases,
  target: agentEvalTarget(accountAgent),
  metrics: [
    turnRelevancy({ model: judgeModel }),
    knowledgeRetention({ model: judgeModel }),
  ],
});
```

Make sure the response contains the history you intend to evaluate. If the target returns a custom
object, use a selector:

```ts
type ConversationOutput = {
  transcript: { role: "user" | "assistant"; content: string }[];
};

turnRelevancy<unknown, ConversationOutput>({
  model: judgeModel,
  turns: ({ output }) => output.transcript,
  windowSize: 8,
});
```

## Design Conversation Cases

Useful conversation datasets include:

- a user supplies a name, locale, plan, or preference and asks about it later
- a user corrects an earlier fact and the assistant must use the newer value
- a follow-up uses pronouns or shorthand that requires recent context
- the topic changes and the assistant should follow the new goal
- the assistant must not ask again for information already supplied
- a long conversation revisits an early constraint

Keep one intended behavior per case. Store scenario labels, prompt versions, and expected behavior in
case metadata so failures can be grouped later.

## Cost And Coverage

Conversation judges scale with the number and length of turns. Use short, incident-shaped
transcripts in pull-request checks and a broader dataset on a scheduled run. `concurrency` limits
simultaneous judge calls within one conversation metric and defaults to `4`. Set
`includeReason: false` when the per-turn verdicts are sufficient.

These metrics evaluate text quality, not runtime safety. Test tool permissions, side effects,
approvals, and hidden-message handling with deterministic runner tests. See
[Testing strategy](/docs/advanced/testing-strategy) for that boundary and the
[core eval reference](/docs/packages/core/reference/evals) for all options.
