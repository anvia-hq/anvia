---
title: "Anthropic Provider"
description: "Public exports from @anvia/anthropic."
section: packages
sidebar:
  group: "anthropic"
  order: 6
  label: "Anthropic Provider"
---
Import from `@anvia/anthropic`.

## AnthropicClient

```ts
type AnthropicClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  client?: Anthropic;
};

class AnthropicClient {
  readonly client: Anthropic;
  constructor(options?: AnthropicClientOptions);
  listModels(): Promise<ModelList>;
  completionModel(model?: AnthropicCompletionModelName): AnthropicCompletionModel;
}
```

Purpose: factory for Anthropic completion models and model listing.

Return behavior: `completionModel(...)` returns a streaming Anvia completion model. `listModels()` fetches Anthropic's model list and returns a normalized `ModelList`.

Notable errors: constructor throws when neither `client` nor `apiKey` is supplied; `listModels()` rejects with `ModelListingError` when the provider request fails.

## Model Name Types

```ts
type AnthropicCompletionModelName = ModelId<KnownAnthropicCompletionModelName>;
```

`KnownAnthropicCompletionModelName` is the union of known Anthropic completion model IDs used for autocomplete.

Purpose: typed model identifiers for autocomplete while preserving support for custom strings.

## AnthropicCompletionModel

```ts
class AnthropicCompletionModel implements StreamingCompletionModel {
  constructor(client: Anthropic, defaultModel?: AnthropicCompletionModelName);
  completion(request: CompletionRequest): Promise<CompletionResponse>;
  streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent>;
}
```

Purpose: adapter for Anthropic Messages API.

Return behavior: maps Anvia completion requests to Anthropic params and returns normalized responses/events.

Notable errors: rejects or yields SDK/provider errors.

## Helper Namespaces

```ts
namespace anthropic {
  AnthropicClient;
  AnthropicCompletionModel;
}
```

Purpose: namespaced access to the same public model/client exports.

Return behavior: export namespaces only.

Notable errors: none directly.
