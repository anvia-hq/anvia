import type { ModelContextLimits } from "@anvia/core/completion";
import type { ModelId } from "@anvia/core/model-listing";

export type KnownGeminiCompletionModelId =
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

export type GeminiCompletionModelId = ModelId<KnownGeminiCompletionModelId>;

const CONTEXT_1M_64K = {
  contextWindow: 1_048_576,
  maxInputTokens: 1_048_576,
  maxOutputTokens: 65_536,
};

export const GEMINI_COMPLETION_MODEL_CONTEXT_LIMITS = {
  "gemini-2.0-flash": {
    contextWindow: 1_048_576,
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8_192,
  },
  "gemini-2.0-flash-lite": {
    contextWindow: 1_048_576,
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8_192,
  },
  "gemini-2.5-flash": CONTEXT_1M_64K,
  "gemini-2.5-flash-image": {
    contextWindow: 32_768,
    maxInputTokens: 32_768,
    maxOutputTokens: 32_768,
  },
  "gemini-2.5-flash-lite": CONTEXT_1M_64K,
  "gemini-2.5-flash-preview-tts": {
    contextWindow: 8_192,
    maxInputTokens: 8_192,
    maxOutputTokens: 16_384,
  },
  "gemini-2.5-pro": CONTEXT_1M_64K,
  "gemini-2.5-pro-preview-tts": {
    contextWindow: 8_192,
    maxInputTokens: 8_192,
    maxOutputTokens: 16_384,
  },
  "gemini-3-flash-preview": CONTEXT_1M_64K,
  "gemini-3-pro-image-preview": {
    contextWindow: 131_072,
    maxInputTokens: 131_072,
    maxOutputTokens: 32_768,
  },
  "gemini-3-pro-preview": CONTEXT_1M_64K,
  "gemini-3.1-flash-image-preview": {
    contextWindow: 65_536,
    maxInputTokens: 65_536,
    maxOutputTokens: 65_536,
  },
  "gemini-3.1-flash-lite": CONTEXT_1M_64K,
  "gemini-3.1-flash-lite-preview": CONTEXT_1M_64K,
  "gemini-3.1-pro-preview": CONTEXT_1M_64K,
  "gemini-3.1-pro-preview-customtools": CONTEXT_1M_64K,
  "gemini-3.5-flash": CONTEXT_1M_64K,
  "gemini-flash-latest": CONTEXT_1M_64K,
  "gemini-flash-lite-latest": CONTEXT_1M_64K,
  "gemma-4-26b-a4b-it": {
    contextWindow: 262_144,
    maxInputTokens: 262_144,
    maxOutputTokens: 32_768,
  },
  "gemma-4-31b-it": {
    contextWindow: 262_144,
    maxInputTokens: 262_144,
    maxOutputTokens: 32_768,
  },
} satisfies Readonly<Record<KnownGeminiCompletionModelId, ModelContextLimits>>;

export type KnownGeminiEmbeddingModelId = "gemini-embedding-001";

export type GeminiEmbeddingModelId = ModelId<KnownGeminiEmbeddingModelId>;

export type KnownGeminiGenerateContentImageModelId =
  | "gemini-2.5-flash-image"
  | "gemini-3-pro-image-preview"
  | "gemini-3.1-flash-image-preview";

export type KnownGeminiGenerateImagesModelId = "imagen-4.0-generate-001";

export type GeminiGenerateContentImageModelId = ModelId<KnownGeminiGenerateContentImageModelId>;
export type GeminiGenerateImagesModelId = ModelId<KnownGeminiGenerateImagesModelId>;

export type GeminiTranscriptionModelId = GeminiCompletionModelId;
