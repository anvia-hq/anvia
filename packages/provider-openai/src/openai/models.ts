import type { ModelId } from "@anvia/core/model-listing";

export type KnownOpenAICompletionModelName =
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
  | "o1"
  | "o1-pro"
  | "o3"
  | "o3-deep-research"
  | "o3-mini"
  | "o3-pro"
  | "o4-mini"
  | "o4-mini-deep-research";

export type OpenAICompletionModelName = ModelId<KnownOpenAICompletionModelName>;

export type KnownOpenAIEmbeddingModelName =
  | "text-embedding-3-large"
  | "text-embedding-3-small"
  | "text-embedding-ada-002";

export type OpenAIEmbeddingModelName = ModelId<KnownOpenAIEmbeddingModelName>;

export type KnownOpenAIImageGenerationModelName =
  | "chatgpt-image-latest"
  | "dall-e-2"
  | "dall-e-3"
  | "gpt-image-1"
  | "gpt-image-1-mini"
  | "gpt-image-1.5"
  | "gpt-image-2";

export type OpenAIImageGenerationModelName = ModelId<KnownOpenAIImageGenerationModelName>;

export type KnownOpenAIAudioGenerationModelName = "tts-1" | "tts-1-hd";

export type OpenAIAudioGenerationModelName = ModelId<KnownOpenAIAudioGenerationModelName>;

export type KnownOpenAITranscriptionModelName = "whisper-1";

export type OpenAITranscriptionModelName = ModelId<KnownOpenAITranscriptionModelName>;
