import type { ModelId } from "@anvia/core/model-listing";

export type KnownGeminiCompletionModelName =
  | "gemini-2.0-flash"
  | "gemini-2.0-flash-lite"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-image"
  | "gemini-2.5-flash-lite"
  | "gemini-2.5-flash-preview-tts"
  | "gemini-2.5-pro"
  | "gemini-2.5-pro-preview-tts"
  | "gemini-3-flash-preview"
  | "gemini-3-pro-image-preview"
  | "gemini-3-pro-preview"
  | "gemini-3.1-flash-image-preview"
  | "gemini-3.1-flash-lite"
  | "gemini-3.1-flash-lite-preview"
  | "gemini-3.1-pro-preview"
  | "gemini-3.1-pro-preview-customtools"
  | "gemini-3.5-flash"
  | "gemini-flash-latest"
  | "gemini-flash-lite-latest"
  | "gemma-4-26b-a4b-it"
  | "gemma-4-31b-it";

export type GeminiCompletionModelName = ModelId<KnownGeminiCompletionModelName>;

export type KnownGeminiEmbeddingModelName = "gemini-embedding-001";

export type GeminiEmbeddingModelName = ModelId<KnownGeminiEmbeddingModelName>;

export type KnownGeminiImageGenerationModelName =
  | "gemini-2.5-flash-image"
  | "gemini-3-pro-image-preview"
  | "gemini-3.1-flash-image-preview"
  | "imagen-4.0-generate-001";

export type GeminiImageGenerationModelName = ModelId<KnownGeminiImageGenerationModelName>;

export type GeminiTranscriptionModelName = GeminiCompletionModelName;
