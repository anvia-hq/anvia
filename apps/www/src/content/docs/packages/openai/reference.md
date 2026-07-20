---
title: "OpenAI Provider"
description: "Public exports from @anvia/openai."
section: packages
sidebar:
  group: "openai"
  order: 6
  label: "OpenAI Provider"
---
Import from `@anvia/openai`.

## OpenAIClient

```ts
type OpenAIClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  completionApi?: "responses" | "chat";
  client?: OpenAI;
};

class OpenAIClient {
  readonly client: OpenAI;
  constructor(options?: OpenAIClientOptions);
  listModels(): Promise<ModelList>;
  completionModel(model?: OpenAICompletionModelName): StreamingCompletionModel;
  embeddingModel(
    model?: OpenAIEmbeddingModelName,
    options?: ProviderEmbeddingModelOptions,
  ): OpenAIEmbeddingModel;
  imageGenerationModel(model?: OpenAIImageGenerationModelName): OpenAIImageGenerationModel;
  audioGenerationModel(model?: OpenAIAudioGenerationModelName): OpenAIAudioGenerationModel;
  transcriptionModel(model?: OpenAITranscriptionModelName): OpenAITranscriptionModel;
}
```

Purpose: factory for OpenAI completion, embedding, image generation, audio generation, transcription, and model listing.

Return behavior: `completionModel(...)` returns a streaming model backed by Responses API by default or chat completions when `completionApi: "chat"` is set. `listModels()` fetches the configured OpenAI or OpenAI-compatible `/models` endpoint and returns a normalized `ModelList`.

Notable errors: constructor throws when neither `client` nor `apiKey` is supplied; `listModels()` rejects with `ModelListingError` when the provider request fails.

## Model Name Types

```ts
type OpenAICompletionModelName = ModelId<KnownOpenAICompletionModelName>;
type OpenAIEmbeddingModelName = ModelId<KnownOpenAIEmbeddingModelName>;
type OpenAIImageGenerationModelName = ModelId<KnownOpenAIImageGenerationModelName>;
type OpenAIAudioGenerationModelName = ModelId<KnownOpenAIAudioGenerationModelName>;
type OpenAITranscriptionModelName = ModelId<KnownOpenAITranscriptionModelName>;
```

Known model unions: `KnownOpenAICompletionModelName`, `KnownOpenAIEmbeddingModelName`, `KnownOpenAIImageGenerationModelName`, `KnownOpenAIAudioGenerationModelName`, and `KnownOpenAITranscriptionModelName`.

Purpose: typed model identifiers for autocomplete while preserving support for custom strings and compatible gateway model IDs.

## Multimodal Models

```ts
class OpenAIImageGenerationModel implements ImageGenerationModel {}
class OpenAIAudioGenerationModel implements AudioGenerationModel {}
class OpenAITranscriptionModel implements TranscriptionModel {}
```

Purpose: OpenAI adapters for `@anvia/core` image generation, text-to-speech, and transcription.

Return behavior: image generation maps base64 image outputs to `Uint8Array`; audio generation maps speech responses to `Uint8Array`; transcription returns normalized text.

Notable errors: rejects on OpenAI SDK errors or when image/transcription responses do not contain expected content.

Model constants: `GPT_IMAGE_1`, `GPT_IMAGE_2`, `DALL_E_2`, `DALL_E_3`, `TTS_1`, `TTS_1_HD`, and `WHISPER_1`.

## OpenAIEmbeddingModel

```ts
type ProviderEmbeddingModelOptions = {
  dimensions?: number;
  user?: string;
  maxBatchSize?: number;
};

class OpenAIEmbeddingModel implements EmbeddingModel {
  readonly dimensions?: number;
  readonly maxBatchSize: number;
  constructor(
    client: OpenAI,
    model: OpenAIEmbeddingModelName,
    options?: ProviderEmbeddingModelOptions,
  );
  embedTexts(texts: string[]): Promise<Embedding[]>;
}
```

Purpose: OpenAI embedding adapter.

Return behavior: returns one `Embedding` per input text.

Notable errors: rejects on OpenAI SDK errors or mismatched embedding counts.

## OpenAIResponsesCompletionModel

```ts
class OpenAIResponsesCompletionModel implements StreamingCompletionModel {
  constructor(client: OpenAI, defaultModel?: OpenAICompletionModelName);
  completion(request: CompletionRequest): Promise<CompletionResponse>;
  streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent>;
}
```

Purpose: completion adapter for OpenAI Responses API.

Return behavior: non-streaming calls return normalized `CompletionResponse`; streaming calls yield normalized completion events. A Responses API `response.failed` event includes normalized usage when the failed response supplies it. Network errors and failures without provider usage omit it.

Notable errors: rejects or yields errors from OpenAI Responses API calls.

## OpenAIChatCompletionModel

```ts
class OpenAIChatCompletionModel implements StreamingCompletionModel {
  constructor(client: OpenAI, defaultModel?: OpenAICompletionModelName);
  completion(request: CompletionRequest): Promise<CompletionResponse>;
  streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent>;
}
```

Purpose: chat-completions adapter used by `OpenAIClient` when `completionApi: "chat"` is set or a custom `baseUrl` is provided.

Return behavior: maps Anvia requests to chat completion params and maps responses back to Anvia content.

Notable errors: rejects or yields provider SDK errors.

## Helper Namespaces

```ts
namespace openai {
  OpenAIClient;
  OpenAIEmbeddingModel;
  OpenAIImageGenerationModel;
  OpenAIAudioGenerationModel;
  OpenAITranscriptionModel;
  OpenAIResponsesCompletionModel;
  OpenAIChatCompletionModel;
}
```

Purpose: namespaced access to the same public model/client exports.

Return behavior: export namespaces only.

Notable errors: none directly.
