import type { ModelContextLimits } from "@anvia/core/completion";
import type { ModelId } from "@anvia/core/model-listing";

export type KnownOpenAICompletionModelId =
  | "gpt-3.5-turbo"
  | "gpt-4"
  | "gpt-4-turbo"
  | "gpt-4.1"
  | "gpt-4.1-mini"
  | "gpt-4.1-nano"
  | "gpt-4o"
  | "gpt-4o-2024-05-13"
  | "gpt-4o-2024-08-06"
  | "gpt-4o-2024-11-20"
  | "gpt-4o-mini"
  | "gpt-5"
  | "gpt-5-chat-latest"
  | "gpt-5-codex"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-5-pro"
  | "gpt-5.1"
  | "gpt-5.1-chat-latest"
  | "gpt-5.1-codex"
  | "gpt-5.1-codex-max"
  | "gpt-5.1-codex-mini"
  | "gpt-5.2"
  | "gpt-5.2-chat-latest"
  | "gpt-5.2-codex"
  | "gpt-5.2-pro"
  | "gpt-5.3-chat-latest"
  | "gpt-5.3-codex"
  | "gpt-5.3-codex-spark"
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.4-nano"
  | "gpt-5.4-pro"
  | "gpt-5.5"
  | "gpt-5.5-pro"
  | "gpt-5.6"
  | "gpt-5.6-cyber"
  | "gpt-5.6-luna"
  | "gpt-5.6-sol"
  | "gpt-5.6-terra"
  | "gpt-6-astra"
  | "gpt-6-cyber"
  | "gpt-6-luna"
  | "gpt-6-rosalind"
  | "gpt-6-sol"
  | "gpt-6.1-sol"
  | "gpt-6.1-terra"
  | "gpt-6.2-astra"
  | "gpt-6.2-astra-law"
  | "gpt-6.2-sol"
  | "gpt-daybreak-blue-latest"
  | "gpt-daybreak-red-latest"
  | "gpt-rosalind-research"
  | "o1"
  | "o1-pro"
  | "o3"
  | "o3-deep-research"
  | "o3-mini"
  | "o3-pro"
  | "o4-mini"
  | "o4-mini-deep-research";

export type OpenAICompletionModelId = ModelId<KnownOpenAICompletionModelId>;

export const GPT_6_LUNA = "gpt-6-luna";
export type KnownOpenAIDecisionModelId = typeof GPT_6_LUNA;
export type OpenAIDecisionModelId = ModelId<KnownOpenAIDecisionModelId>;

export const DALL_E_2 = "dall-e-2";
export const DALL_E_3 = "dall-e-3";
export const GPT_IMAGE_1 = "gpt-image-1";
export const GPT_IMAGE_2 = "gpt-image-2";

export const TTS_1 = "tts-1";
export const TTS_1_HD = "tts-1-hd";
export const GPT_4O_MINI_TTS = "gpt-4o-mini-tts";

export const WHISPER_1 = "whisper-1";
export const GPT_TRANSCRIBE = "gpt-transcribe";
export const GPT_4O_TRANSCRIBE = "gpt-4o-transcribe";
export const GPT_4O_MINI_TRANSCRIBE = "gpt-4o-mini-transcribe";
export const GPT_4O_TRANSCRIBE_DIARIZE = "gpt-4o-transcribe-diarize";

const CONTEXT_128K_16K = { contextWindow: 128_000, maxOutputTokens: 16_384 };
const CONTEXT_200K_100K = { contextWindow: 200_000, maxOutputTokens: 100_000 };
const CONTEXT_400K_128K = {
  contextWindow: 400_000,
  maxInputTokens: 272_000,
  maxOutputTokens: 128_000,
};
const CONTEXT_1M_128K = {
  contextWindow: 1_050_000,
  maxInputTokens: 922_000,
  maxOutputTokens: 128_000,
};

const KNOWN_OPENAI_COMPLETION_MODEL_CONTEXT_LIMITS = {
  "gpt-3.5-turbo": { contextWindow: 16_385, maxOutputTokens: 4_096 },
  "gpt-4": { contextWindow: 8_192, maxOutputTokens: 8_192 },
  "gpt-4-turbo": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "gpt-4.1": { contextWindow: 1_047_576, maxOutputTokens: 32_768 },
  "gpt-4.1-mini": { contextWindow: 1_047_576, maxOutputTokens: 32_768 },
  "gpt-4.1-nano": { contextWindow: 1_047_576, maxOutputTokens: 32_768 },
  "gpt-4o": CONTEXT_128K_16K,
  "gpt-4o-2024-05-13": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "gpt-4o-2024-08-06": CONTEXT_128K_16K,
  "gpt-4o-2024-11-20": CONTEXT_128K_16K,
  "gpt-4o-mini": CONTEXT_128K_16K,
  "gpt-5": CONTEXT_400K_128K,
  "gpt-5-chat-latest": CONTEXT_400K_128K,
  "gpt-5-codex": CONTEXT_400K_128K,
  "gpt-5-mini": CONTEXT_400K_128K,
  "gpt-5-nano": CONTEXT_400K_128K,
  "gpt-5-pro": { contextWindow: 400_000, maxInputTokens: 272_000, maxOutputTokens: 272_000 },
  "gpt-5.1": CONTEXT_400K_128K,
  "gpt-5.1-chat-latest": CONTEXT_128K_16K,
  "gpt-5.1-codex": CONTEXT_400K_128K,
  "gpt-5.1-codex-max": CONTEXT_400K_128K,
  "gpt-5.1-codex-mini": CONTEXT_400K_128K,
  "gpt-5.2": CONTEXT_400K_128K,
  "gpt-5.2-chat-latest": CONTEXT_128K_16K,
  "gpt-5.2-codex": CONTEXT_400K_128K,
  "gpt-5.2-pro": CONTEXT_400K_128K,
  "gpt-5.3-chat-latest": CONTEXT_128K_16K,
  "gpt-5.3-codex": CONTEXT_400K_128K,
  "gpt-5.3-codex-spark": {
    contextWindow: 128_000,
    maxInputTokens: 100_000,
    maxOutputTokens: 32_000,
  },
  "gpt-5.4": CONTEXT_1M_128K,
  "gpt-5.4-mini": CONTEXT_400K_128K,
  "gpt-5.4-nano": CONTEXT_400K_128K,
  "gpt-5.4-pro": CONTEXT_1M_128K,
  "gpt-5.5": CONTEXT_1M_128K,
  "gpt-5.5-pro": CONTEXT_1M_128K,
  "gpt-5.6": CONTEXT_1M_128K,
  "gpt-5.6-cyber": CONTEXT_1M_128K,
  "gpt-5.6-luna": CONTEXT_1M_128K,
  "gpt-5.6-sol": CONTEXT_1M_128K,
  "gpt-5.6-terra": CONTEXT_1M_128K,
  "gpt-6-astra": CONTEXT_1M_128K,
  "gpt-6-cyber": CONTEXT_1M_128K,
  "gpt-6-luna": CONTEXT_1M_128K,
  "gpt-6-rosalind": CONTEXT_1M_128K,
  "gpt-6-sol": CONTEXT_1M_128K,
  "gpt-6.1-sol": CONTEXT_1M_128K,
  "gpt-6.1-terra": CONTEXT_1M_128K,
  "gpt-6.2-astra": CONTEXT_1M_128K,
  "gpt-6.2-astra-law": CONTEXT_1M_128K,
  "gpt-6.2-sol": CONTEXT_1M_128K,
  "gpt-daybreak-blue-latest": CONTEXT_1M_128K,
  "gpt-daybreak-red-latest": CONTEXT_1M_128K,
  "gpt-rosalind-research": CONTEXT_1M_128K,
  o1: CONTEXT_200K_100K,
  "o1-pro": CONTEXT_200K_100K,
  o3: CONTEXT_200K_100K,
  "o3-deep-research": CONTEXT_200K_100K,
  "o3-mini": CONTEXT_200K_100K,
  "o3-pro": CONTEXT_200K_100K,
  "o4-mini": CONTEXT_200K_100K,
  "o4-mini-deep-research": CONTEXT_200K_100K,
} satisfies Readonly<Record<KnownOpenAICompletionModelId, ModelContextLimits>>;

export const OPENAI_COMPLETION_MODEL_CONTEXT_LIMITS: Readonly<Record<string, ModelContextLimits>> =
  {
    ...KNOWN_OPENAI_COMPLETION_MODEL_CONTEXT_LIMITS,
    "openai/gpt-5.2": CONTEXT_400K_128K,
  };

export type KnownOpenAIEmbeddingModelId =
  | "text-embedding-3-large"
  | "text-embedding-3-small"
  | "text-embedding-ada-002";

export type OpenAIEmbeddingModelId = ModelId<KnownOpenAIEmbeddingModelId>;

export type KnownOpenAIImageGenerationModelId =
  | "chatgpt-image-latest"
  | "dall-e-2"
  | "dall-e-3"
  | "gpt-image-1"
  | "gpt-image-1-mini"
  | "gpt-image-1.5"
  | "gpt-image-2"
  | "gpt-image-2-2026-04-21"
  | "gpt-image-2.5-flare"
  | "gpt-image-2.5-flare-2026-09-08"
  | "gpt-image-2.5-sunburst"
  | "gpt-image-2.5-sunburst-2026-09-08"
  | "gpt-image-2.6-flare"
  | "gpt-image-2.6-sunburst";

export type OpenAIImageGenerationModelId = ModelId<KnownOpenAIImageGenerationModelId>;

export type KnownOpenAISpeechGenerationModelId =
  | "gpt-4o-mini-tts"
  | "gpt-4o-mini-tts-2025-03-20"
  | "gpt-4o-mini-tts-2025-12-15"
  | "tts-1"
  | "tts-1-hd";

export type OpenAISpeechGenerationModelId = ModelId<KnownOpenAISpeechGenerationModelId>;

export type KnownOpenAITranscriptionModelId =
  | "gpt-4o-mini-transcribe"
  | "gpt-4o-mini-transcribe-2025-03-20"
  | "gpt-4o-mini-transcribe-2025-12-15"
  | "gpt-4o-transcribe"
  | "gpt-4o-transcribe-diarize"
  | "gpt-transcribe"
  | "whisper-1";

export type OpenAITranscriptionModelId = ModelId<KnownOpenAITranscriptionModelId>;
