# Typed decisions

`@anvia/core/decision` exposes provider-neutral questions and operations for software that needs
bounded judgments. It can classify documents, select handlers, score candidates, match records,
or select a value from a list of candidate spans. Applications call it directly without an agent.

Create a provider client, obtain a decision model, and call `decide({ model, state, questions })`.
The same operations and types are exported from `@anvia/core`.

## Questions and answers

```ts
import { JevClient } from "@anvia/jev";
import { check, choice, decide, multiLabel, score } from "@anvia/core/decision";

const model = new JevClient({ apiKey: process.env.TYPESAFE_API_KEY }).decisionModel({
  modelId: "jev-latest",
});

const result = await decide({
  model,
  state: { message: "My subscription renewed twice. Please refund the duplicate." },
  questions: {
    department: choice({
      instructions: "Which department should handle this?",
      options: {
        billing: "Payments, invoices, and refunds",
        technical: "Product bugs and technical problems",
        general: "Other requests",
      },
    }),
    topics: multiLabel({
      instructions: "Select all topics present in the message.",
      options: {
        subscription: "Subscriptions and renewals",
        duplicateCharge: "Multiple charges for the same purchase",
        refund: "Requests to return a payment",
      },
      threshold: 0.7,
    }),
    urgency: score({
      instructions: "How urgently does this need attention?",
      rubric: ["Low", "Normal", "High", "Critical"],
    }),
    cancellation: check({
      instructions: "Is the customer asking to cancel their subscription?",
    }),
  },
});

result.answers.department.choice; // "billing" | "technical" | "general"
result.answers.topics.labels; // readonly array of the three topic keys
result.answers.urgency.score; // position on the 0–3 rubric, potentially fractional
result.answers.cancellation.probability; // estimated probability of yes, 0–1
result.usage; // optional normalized Anvia token usage
result.rawResponse; // original provider result
```

| Helper                                              | Answer                                                       | Semantics                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `choice({ instructions, options })`                 | `choice`, optional `probabilities` and `confidence`          | One selected option; probabilities are exclusive and sum to one.                                                       |
| `multiLabel({ instructions, options, threshold? })` | `labels`, `probabilities`                                    | Each label has an independent probability. Select probabilities greater than or equal to the threshold, default `0.5`. |
| `score({ instructions, rubric })`                   | `score`, `rubric`, optional `probabilities` and `confidence` | A position on a zero-indexed ordered rubric. Distributions follow rubric order.                                        |
| `check({ instructions })`                           | `probability`                                                | Probability of yes. Application code chooses its action threshold.                                                     |

Options accept JSON descriptions, including `null` for an undescribed label. Rubrics require at
least two JSON levels. State accepts JSON-compatible strings, objects, arrays, scalars, or `null`.
Question names identify typed answers. Define question objects once and reuse them across inputs.

Probabilities and confidence are provider-reported estimates. Anvia does not calibrate them or derive
confidence from the selected option's probability. Relevance scores from native rerankers have
different semantics and are not converted into probabilities by this contract. To prioritize items,
score them on the same rubric and sort or combine dimensions in application code.

## Retries and cancellation

```ts
const controller = new AbortController();

const result = await decide({
  model,
  state: "Please refund the duplicate charge.",
  questions: { refund: check({ instructions: "Is a refund requested?" }) },
  retries: { maxAttempts: 3 },
  abortSignal: controller.signal,
});
```

Retries are disabled by default. `retries: false` explicitly disables them. `RetrySetting` uses the
existing Anvia retry policy; `maxAttempts` includes the initial call. A custom `shouldRetry` can
change which failures qualify. Cancellation rejects with an `AbortError`, including cancellation
that occurs while a provider is completing its response.

`providerOptions` carries provider-specific JSON settings. Adapters must preserve the model,
state, and question contract when applying those settings.

## Batches

```ts
import { decideBatch } from "@anvia/core/decision";

const questions = {
  department: choice({
    instructions: "Which department?",
    options: { billing: "Payments", technical: "Bugs", general: "Other" },
  }),
};

const { items } = await decideBatch({
  model,
  inputs: ["Refund my payment", "The app crashes"].map((message) => ({
    state: { message },
    questions,
  })),
  concurrency: 4,
});

for (const item of items) {
  if (item.status === "completed") console.log(item.index, item.result.answers);
  else console.error(item.index, item.error);
}
```

`decideBatch()` accepts a finite iterable, buffers its inputs, and returns ordered `items`.
Each item contains `index` and either a completed `result` or a failed `error`. Individual failures
do not stop other items. A positive safe-integer `concurrency` is required. The batch supports
`retries` and `abortSignal`; cancellation stops scheduling more items and rejects the batch.

## Custom providers

Implement `DecisionModel<RawResponse>` with `provider`, `modelId`, `capabilities`, and the generic
`decision(request, options?)` method. `DecisionRequest` contains `state`, `questions`, and optional
`providerOptions`; `ModelCallOptions` carries `abortSignal` separately from the payload.
`DecisionResult<Questions, RawResponse>` preserves question and raw response types.

`capabilities.questionSupport` declares `native`, `composed`, or `unsupported` for each of
`choice`, `multi-label`, `score`, and `check`. Providers own composition. `mixedQuestions`
declares whether different question types can share a request. Optional limits declare maximum
questions, choice options, labels, and rubric levels. Unknown limits should be omitted.

Core validates questions and capabilities before calling the provider. It validates answer types,
option keys, probability distributions, thresholds, rubric bounds, and usage after the call.
Unsupported question types throw `DecisionCapabilityError`. Malformed responses throw
`DecisionProviderOutputError`, carrying provider/model metadata and the question name when known.
Invalid caller input throws `TypeError` or `RangeError`.

The low-level `model.decision()` method performs one invocation; use `decide()` to get the core
validation and retry layer. Decision operations can be used inside existing `Pipeline.step()`,
agent hooks, tools, or custom eval metrics without new integration methods.

## Public exports

- Functions: `decide`, `decideBatch`, `choice`, `multiLabel`, `score`, `check`.
- Errors: `DecisionCapabilityError`, `DecisionProviderOutputError`.
- Questions: `DecisionOptions`, `DecisionRubric`, `ChoiceQuestion`, `MultiLabelQuestion`,
  `ScoreQuestion`, `CheckQuestion`, `DecisionQuestion`, `DecisionQuestions`, `DecisionQuestionType`.
- Answers: `ChoiceAnswer`, `MultiLabelAnswer`, `ScoreAnswer`, `CheckAnswer`,
  `DecisionAnswerFor`, `DecisionAnswers`, `DecisionResult`.
- Models and operations: `DecisionModel`, `DecisionCapabilities`, `DecisionRequest`,
  `DecisionRawResponseOf`, `DecideOptions`, `DecideBatchOptions`, `DecisionBatchItem`,
  `DecisionBatchResult`.
- Shared types: `JsonObject`, `JsonValue`, `Usage`, `ModelCallOptions`, `RetryContext`,
  `RetryOptions`, `RetrySetting`.
