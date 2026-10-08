# @anvia/openai

OpenAI provider adapter for Anvia.

Use this package when you want Anvia agents, direct completions, typed decisions, embeddings, image generation,
speech generation, or transcription to run on OpenAI models or OpenAI-compatible endpoints.

For Azure OpenAI and Azure AI Foundry, use [`@anvia/azure`](./provider-azure.md).
It owns Azure configuration and Responses event normalization while reusing common
request and response mapping. Use `AzureOpenAIClient` for Azure-specific stream handling.

## Installation

```sh
pnpm add @anvia/openai @anvia/core
```

### Bun

Bun 1.3.14 is the currently tested and supported runtime baseline:

```sh
bun add @anvia/openai @anvia/core
```

Compatibility tests exercise the OpenAI SDK's JSON, streaming, abort, multipart, and binary media
paths without contacting a model provider.

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/openai build
```

## Usage

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey,
});

const model = client.completionModel({ modelId: "gpt-5.6", api: "responses" });

const agent = new Agent({
  id: "assistant",
  model: model,
  instructions: "Answer clearly and concisely.",
});

// The model-specific union is inferred: none | low | medium | high | xhigh | max.
await agent.generate({ prompt: "Solve this.", controls: { reasoningEffort: "high" } });

const result = await agent.generate({ prompt: "Summarize Anvia in one sentence." });
if (result.type === "response") console.log(result.output);
```

## Typed decisions

Use the dedicated OpenAI Decisions API through the same provider-neutral operations as Jev:

```ts
import { OpenAIClient, GPT_6_LUNA } from "@anvia/openai";
import { check, choice, decide, multiLabel, score } from "@anvia/core/decision";

const model = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! }).decisionModel({
  modelId: GPT_6_LUNA,
});

const result = await decide({
  model,
  state: { message: "I was charged twice. Please refund the duplicate." },
  questions: {
    department: choice({
      instructions: "Which department should handle this?",
      options: { billing: "Payments and refunds", technical: "Product issues", other: null },
    }),
    topics: multiLabel({
      instructions: "Which topics are present?",
      options: { refund: "Refund requests", duplicate: "Duplicate charges" },
      threshold: 0.7,
    }),
    urgency: score({ instructions: "How urgent?", rubric: ["Low", "Normal", "High"] }),
    cancellation: check({ instructions: "Is cancellation requested?" }),
  },
});

console.log(result.answers.department.choice);
console.log(result.answers.urgency.score);
```

The API is currently in public beta with `gpt-6-luna`. `decisionModel({ modelId })` requires a
non-blank model ID and also accepts custom IDs for endpoints implementing the same Decisions
schema. This package requires OpenAI SDK 7.30.0 or newer. Managed and injected SDK clients are
supported; every decision call sets SDK `maxRetries: 0` so Anvia owns retries and cancellation.
SDK connection failures use errors named `APIConnectionError` and preserve the SDK error as `cause`.
SDK timeouts use errors named `TimeoutError` and retain the SDK error as `providerError`, keeping internal
timeout aborts distinct from caller cancellation. Malformed JSON uses `DecisionProviderOutputError`.

| Anvia question | OpenAI mapping                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `check`        | Native `predicate`; returns probability of true.                                               |
| `choice`       | Native `choice`; string option keys become choice values.                                      |
| `score`        | Native `score`; rubric indices become level labels and descriptions preserve the criteria.     |
| `multi-label`  | One independent `predicate` per label in the same request; inclusive threshold selects labels. |

Mixed questions use one `decisions.create()` call. Generated question IDs preserve application
names safely. Choice requires 2–255 options and score accepts up to 10 rubric levels. A request
sends at most 200 OpenAI questions, counting each multi-label option as one question. These limits
are checked before network work. Returned distributions must cover exactly the requested
options or rubric indices; score labels must match the sent levels. Provider confidence is preserved
separately from the distribution.

Plain text state is sent unchanged. Objects, arrays, numbers, booleans, and `null` are JSON-serialized
into OpenAI's text `input`. Option and rubric descriptions use the same conversion; `null` leaves a
description omitted. Original Anvia rubric values remain in the normalized answer. The current
Anvia decision state contract supports text and structured JSON, not native image parts; arrays
of image messages are serialized as text. Native image decisions can be called through the SDK
until Anvia has a typed multimodal decision-input contract.

`providerOptions` forwards extra JSON body fields, such as `safety_identifier`, while preserving
`model`, `input`, and `questions`. Usage includes cache-read, cache-write, and reasoning token
counts. `rawResponse` preserves the original SDK response, including provider answer fields and
request metadata.

### Refusals

OpenAI may refuse individual questions while answering others. `decide()` requires a complete
result and throws the provider-neutral `DecisionRefusalError` if any question is refused:

```ts
import { DecisionRefusalError } from "@anvia/core/decision";

const questions = { ok: check({ instructions: "Does the input satisfy the requirements?" }) };
try {
  await decide({ model, state: "Input to evaluate", questions });
} catch (error) {
  if (error instanceof DecisionRefusalError) {
    console.log(error.provider, error.modelId, error.questionNames);
    // Original response includes any other native answers that were returned.
    console.log(error.rawResponse);
  } else {
    throw error;
  }
}
```

`questionNames` contains original application names, deduplicated when several predicates for one
multi-label question are refused. Refusals are not retried by the default policy; an explicit custom
`shouldRetry` can override that policy. `decideBatch()` records a refused input as a failed item and
continues other inputs. Malformed answers remain `DecisionProviderOutputError` failures.

See the [decision guide](./decision.md), [official OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions),
and [API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

## OpenAI-Compatible APIs

`baseUrl` changes only the endpoint. Model handles default to the Chat Completions API; opt into
Responses with `api: "responses"` per handle:

```ts
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey,
  baseUrl,
});

const model = client.completionModel({ modelId: "openai/gpt-5.2", api: "chat" });
```

The same client can create both `{ api: "chat" }` (the default) and `{ api: "responses" }` handles.
Known reasoning models advertise a typed `reasoningEffort` control. For custom OpenAI-compatible
model IDs, pass an explicit `controls` descriptor to `completionModel()` when the endpoint supports
the same parameter. Canonical controls map to `reasoning.effort` for Responses and
`reasoning_effort` for Chat Completions, taking precedence over conflicting `providerOptions`.

### Reasoning tool-call providers

Some OpenAI-compatible chat-completions providers return reasoning in provider-specific
fields while using normal tool calls. For example, Moonshot Kimi K2.6 returns
`reasoning_content` when thinking is enabled.

The chat-completions adapter preserves this reasoning in assistant history and sends it
back as `reasoning_content` on later turns. This matters after tool calls: providers
such as Moonshot can reject the next request if an assistant `tool_calls` message is
missing its prior `reasoning_content`.

For Moonshot Kimi K2.6 thinking mode:

```ts
import { generateCompletion } from "@anvia/core";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: "https://api.moonshot.ai/v1",
});

const model = client.completionModel({ modelId: "kimi-k2.6", api: "chat" });

const response = await generateCompletion({
  model,
  messages: chatHistory,
  tools,
  maxTokens: 16_000,
  providerOptions: {
    thinking: { type: "enabled", keep: "all" },
  },
});
```

Provider caveat: Moonshot rejects forced/specified `tool_choice` while thinking is
enabled. Let the model choose tools naturally when using Kimi thinking mode.

## Other Models

```ts
const embeddingModel = client.embeddingModel({ modelId: "text-embedding-3-small" });
const imageModel = client.imageGenerationModel({ modelId: "gpt-image-2" });
const speechModel = client.speechGenerationModel({ modelId: "gpt-4o-mini-tts" });
const transcriptionModel = client.transcriptionModel({ modelId: "gpt-4o-mini-transcribe" });
```

Use the provider-neutral helpers from `@anvia/core` to call media models:

```ts
import { generateImage, generateSpeech, transcribe } from "@anvia/core";

const image = await generateImage({ model: imageModel, prompt: "A launch poster." });
const speech = await generateSpeech({
  model: speechModel,
  text: "Hello from Anvia.",
  voice: "alloy",
});
const transcript = await transcribe({
  model: transcriptionModel,
  audio: { data: speech.audio.data, filename: "speech.mp3" },
});
```

## Exports

`@anvia/openai/adapters` exports `OpenAIResponsesCompletionModel` for provider-package
authors. Subclasses can override the protected `normalizeStream()` method to adapt raw
events before common parsing and validation, and `requestParams()` to adapt outgoing requests.
The OpenAI implementation passes events
through unchanged and contains no Azure name-recovery mapper. Ordinary applications
should use `OpenAIClient` or their provider's client.

- `OpenAIClient`
- structural completion, decision, embedding, image, speech, and transcription handle types
- `OpenAICompletionModelId`, `OpenAIDecisionModelId`, `KnownOpenAIDecisionModelId`, and media model-ID types
- `OpenAIDecisionModelOptions`, `OpenAIDecisionModelHandle`, and `GPT_6_LUNA`
- model constants such as `GPT_IMAGE_2`, `GPT_4O_MINI_TTS`, and `GPT_TRANSCRIBE`
- `openai`
