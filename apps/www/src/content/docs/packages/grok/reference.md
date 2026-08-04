---
title: "Grok Provider"
description: "Public exports from @anvia/grok."
section: packages
sidebar:
  group: "grok"
  order: 6
  label: "Grok Provider"
---
Import from `@anvia/grok`.

## GrokClient

```ts
type GrokClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  completionApi?: "responses" | "chat";
  client?: OpenAI;
  fetch?: typeof fetch;
};

class GrokClient {
  readonly client: OpenAI;
  constructor(options?: GrokClientOptions);
  listModels(): Promise<ModelList>;
  completionModel(
    model?: GrokCompletionModelName,
  ): GrokResponsesCompletionModel | GrokChatCompletionModel;
  imageGenerationModel(model?: GrokImageGenerationModelName): GrokImageGenerationModel;
  audioGenerationModel(): GrokAudioGenerationModel;
  transcriptionModel(): GrokTranscriptionModel;
}
```

Purpose: factory for xAI Grok completion, image generation, batch TTS/STT, and model listing
adapters.

Return behavior: `completionModel(...)` returns the Responses adapter by default or the Chat Completions adapter when `completionApi: "chat"` is set. `listModels()` fetches xAI's `/models` endpoint and returns a normalized `ModelList`.

Notable errors: constructor throws when neither `client` nor `apiKey` is supplied; `listModels()` rejects with `ModelListingError` when the provider request fails.

## Model Name Types

```ts
type GrokCompletionModelName = ModelId<KnownGrokCompletionModelName>;
type GrokImageGenerationModelName = ModelId<KnownGrokImageGenerationModelName>;
```

Known model unions: `KnownGrokCompletionModelName` and `KnownGrokImageGenerationModelName`.

Purpose: typed model identifiers for autocomplete while preserving support for custom strings.

## Completion Models

```ts
class GrokResponsesCompletionModel implements StreamingCompletionModel {
  readonly provider: "grok";
  constructor(client: OpenAI, defaultModel?: GrokCompletionModelName, options?: CompletionModelMetadataOptions);
  getModelInfo(model?: GrokCompletionModelName): CompletionModelInfo | undefined;
  completion(request: CompletionRequest): Promise<CompletionResponse>;
  streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent>;
}

class GrokChatCompletionModel implements StreamingCompletionModel {
  readonly provider: "grok-chat";
  constructor(client: OpenAI, defaultModel?: GrokCompletionModelName, options?: CompletionModelMetadataOptions);
  getModelInfo(model?: GrokCompletionModelName): CompletionModelInfo | undefined;
  completion(request: CompletionRequest): Promise<CompletionResponse>;
  streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent>;
}
```

Purpose: OpenAI-compatible completion adapters for xAI's Responses and Chat Completions endpoints.

Return behavior: non-streaming calls return normalized `CompletionResponse`; streaming calls yield normalized completion events.

The Responses adapter accepts typed Grok provider tools and normalizes `CompletionSource`,
`ProviderToolCall`, `source`, and `provider_tool_call` data. The Chat adapter does not support
provider-executed tools.

Notable errors: rejects unsupported requests through the delegated OpenAI-compatible adapter; rejects or yields provider SDK errors for transport failures.

## GrokImageGenerationModel

```ts
class GrokImageGenerationModel implements ImageGenerationModel {
  readonly provider: "grok";
  constructor(
    client: OpenAI,
    defaultModel?: GrokImageGenerationModelName,
    fetchFn?: typeof fetch,
  );
  imageGeneration(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
}
```

Purpose: adapter for xAI image generation through Anvia's `ImageGenerationModel` contract.

Return behavior: maps Anvia width and height to xAI `aspect_ratio`, requests base64 output, and returns generated image bytes.

Notable errors: rejects when the provider response contains no image data or when URL image output is returned without a fetch implementation.

Unsupported ratios map to `auto`; explicit `additionalParams.aspect_ratio` overrides the mapped
value.

## Grok Server Tools

```ts
const tools: {
  webSearch(options?: GrokWebSearchOptions): GrokProviderTool;
  xSearch(options?: GrokXSearchOptions): GrokProviderTool;
  codeInterpreter(): GrokProviderTool;
  fileSearch(options: GrokFileSearchOptions): GrokProviderTool;
  mcp(options: GrokMcpOptions): GrokProviderTool;
};
```

Purpose: typed xAI Responses configurations for web search, X search, code interpreter,
collections search, and remote MCP.

Return behavior: returns `ProviderTool` values accepted by core `.tool(...)` and `.tools(...)`
APIs. The factories validate documented exclusivity, count, date, URL, and required-field rules.

## GrokAudioGenerationModel And GrokTranscriptionModel

```ts
class GrokAudioGenerationModel implements AudioGenerationModel;
class GrokTranscriptionModel implements TranscriptionModel;
```

Purpose: batch xAI `/v1/tts` and `/v1/stt` adapters using Anvia's core media contracts.

Return behavior: TTS returns binary or decoded base64 audio. STT returns normalized text and keeps
the provider JSON as `rawResponse`.

## Constants

```ts
const XAI_BASE_URL = "https://api.x.ai/v1";
const GROK_4_5 = "grok-4.5";
const GROK_4_3 = "grok-4.3";
const GROK_4_20 = "grok-4.20";
const GROK_4_20_NON_REASONING = "grok-4.20-non-reasoning";
const GROK_BUILD_0_1 = "grok-build-0.1";
const GROK_IMAGINE_IMAGE = "grok-imagine-image";
const GROK_IMAGINE_IMAGE_QUALITY = "grok-imagine-image-quality";
```

Purpose: commonly used xAI endpoint and model identifiers.

## Helper Namespace

```ts
namespace grok {
  GrokClient;
  GrokResponsesCompletionModel;
  GrokChatCompletionModel;
  GrokImageGenerationModel;
  GrokAudioGenerationModel;
  GrokTranscriptionModel;
  tools;
  XAI_BASE_URL;
  GROK_4_3;
  GROK_4_5;
  GROK_4_20;
  GROK_4_20_NON_REASONING;
  GROK_BUILD_0_1;
  GROK_IMAGINE_IMAGE;
  GROK_IMAGINE_IMAGE_QUALITY;
  aspectRatio;
  imageResponseFromGrok;
}
```

Purpose: namespaced access to the same public Grok exports.

Return behavior: export namespace only.

Notable errors: none directly.

## Image Helpers

```ts
function aspectRatio(width: number, height: number): string;
function imageResponseFromGrok(
  response: unknown,
  fetchFn?: typeof fetch,
): Promise<ImageGenerationResponse>;
```

Purpose: utilities used by the xAI image generation adapter.

Return behavior: `aspectRatio(...)` normalizes dimensions such as `1920x1080` to `16:9`. `imageResponseFromGrok(...)` converts xAI image response data into Anvia image generation output.
