---
title: "Gemini Provider"
description: "Public exports from @anvia/gemini."
section: packages
sidebar:
  group: "gemini"
  order: 6
  label: "Gemini Provider"
---
Import from `@anvia/gemini`.

## GeminiClient

```ts
type GeminiClientOptions =
  | { apiKey?: string; vertexai?: false; client?: GoogleGenAI }
  | { vertexai: true; project?: string; location?: string; client?: GoogleGenAI };

class GeminiClient {
  readonly client: GoogleGenAI;
  constructor(options?: GeminiClientOptions);
  listModels(): Promise<ModelList>;
  completionModel(model?: GeminiCompletionModelName): GeminiCompletionModel;
  embeddingModel(
    model?: GeminiEmbeddingModelName,
    options?: GeminiEmbeddingModelOptions,
  ): GeminiEmbeddingModel;
  imageGenerationModel(model?: GeminiImageGenerationModelName): GeminiImageGenerationModel;
  imagenGenerationModel(model?: GeminiImageGenerationModelName): GeminiImagenGenerationModel;
  transcriptionModel(model?: GeminiTranscriptionModelName): GeminiTranscriptionModel;
}
```

Purpose: factory for Gemini API or Vertex AI-backed completion, embedding, image generation, transcription, and model listing.

Return behavior: creates or uses a `GoogleGenAI` client, then returns Gemini completion and embedding models. `listModels()` fetches the Gemini model list and returns a normalized `ModelList`.

Notable errors: underlying SDK calls can fail for missing credentials, invalid project/location, or API errors; `listModels()` rejects with `ModelListingError` when the provider request fails.

## Model Name Types

```ts
type GeminiCompletionModelName = ModelId<KnownGeminiCompletionModelName>;
type GeminiEmbeddingModelName = ModelId<KnownGeminiEmbeddingModelName>;
type GeminiImageGenerationModelName = ModelId<KnownGeminiImageGenerationModelName>;
type GeminiTranscriptionModelName = GeminiCompletionModelName;
```

Known model unions: `KnownGeminiCompletionModelName`, `KnownGeminiEmbeddingModelName`, and `KnownGeminiImageGenerationModelName`.

Purpose: typed model identifiers for autocomplete while preserving support for custom strings.

## Multimodal Models

```ts
class GeminiImageGenerationModel implements ImageGenerationModel {}
class GeminiImagenGenerationModel implements ImageGenerationModel {}
class GeminiTranscriptionModel implements TranscriptionModel {}
```

Purpose: Gemini adapters for `@anvia/core` image generation and transcription.

Return behavior: `imageGenerationModel()` uses Gemini native image generation through `generateContent` and maps inline image parts to `Uint8Array`. `imagenGenerationModel()` uses Imagen through `generateImages` and maps `generatedImages[].image.imageBytes` to `Uint8Array`. Transcription sends inline audio through `generateContent` and returns normalized text.

Notable errors: rejects on Gemini SDK errors or when image/transcription responses do not contain expected content.

Model constants: `GEMINI_2_5_FLASH_IMAGE`, `GEMINI_3_PRO_IMAGE_PREVIEW`, and `IMAGEN_4_GENERATE`.

Gemini audio generation is not implemented in v1.

## GeminiCompletionModel

```ts
class GeminiCompletionModel implements StreamingCompletionModel {
  constructor(client: GoogleGenAI, defaultModel?: GeminiCompletionModelName);
  completion(request: CompletionRequest): Promise<CompletionResponse>;
  streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent>;
}
```

Purpose: adapter for Gemini content generation.

Return behavior: returns normalized completion responses and stream events.

Notable errors: rejects or yields SDK/provider errors.

## GeminiEmbeddingModel

```ts
type GeminiEmbeddingTaskType =
  | "TASK_TYPE_UNSPECIFIED"
  | "RETRIEVAL_QUERY"
  | "RETRIEVAL_DOCUMENT"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION"
  | "CODE_RETRIEVAL_QUERY";

type GeminiEmbeddingModelOptions = {
  dimensions?: number;
  maxBatchSize?: number;
  taskType?: GeminiEmbeddingTaskType;
  title?: string;
};

class GeminiEmbeddingModel implements EmbeddingModel {
  readonly dimensions?: number;
  readonly maxBatchSize: number;
  constructor(
    client: GoogleGenAI,
    model: GeminiEmbeddingModelName,
    options?: GeminiEmbeddingModelOptions,
  );
  embedTexts(texts: string[]): Promise<Embedding[]>;
}
```

Purpose: Gemini embedding adapter.

Return behavior: returns one `Embedding` per input text.

Notable errors: rejects on SDK errors or mismatched embedding counts.

## gemini Namespace

```ts
namespace gemini {
  GeminiClient;
  GeminiCompletionModel;
  GeminiEmbeddingModel;
  GeminiImageGenerationModel;
  GeminiImagenGenerationModel;
  GeminiTranscriptionModel;
}
```

Purpose: namespaced access to the same public Gemini exports.

Return behavior: export namespace only.

Notable errors: none directly.
