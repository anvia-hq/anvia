import type { ModelId } from "@anvia/core/model-listing";

export type KnownMistralCompletionModelName =
  | "codestral-latest"
  | "devstral-2512"
  | "devstral-latest"
  | "devstral-medium-2507"
  | "devstral-medium-latest"
  | "devstral-small-2505"
  | "devstral-small-2507"
  | "labs-devstral-small-2512"
  | "magistral-medium-latest"
  | "magistral-small"
  | "ministral-3b-latest"
  | "ministral-8b-latest"
  | "mistral-large-2411"
  | "mistral-large-2512"
  | "mistral-large-latest"
  | "mistral-medium-2505"
  | "mistral-medium-2508"
  | "mistral-medium-2604"
  | "mistral-medium-latest"
  | "mistral-nemo"
  | "mistral-small-2506"
  | "mistral-small-2603"
  | "mistral-small-latest"
  | "open-mistral-7b"
  | "open-mistral-nemo"
  | "open-mixtral-8x22b"
  | "open-mixtral-8x7b"
  | "pixtral-12b"
  | "pixtral-large-latest";

export type MistralCompletionModelName = ModelId<KnownMistralCompletionModelName>;

export type KnownMistralEmbeddingModelName = "mistral-embed";

export type MistralEmbeddingModelName = ModelId<KnownMistralEmbeddingModelName>;

export type KnownMistralOcrModelName = "mistral-ocr-latest";

export type MistralOcrModelName = ModelId<KnownMistralOcrModelName>;
