import type { ModelContextLimits } from "@anvia/core/completion";
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

const CONTEXT_128K = { contextWindow: 128_000, maxOutputTokens: 128_000 };
const CONTEXT_256K = { contextWindow: 256_000, maxOutputTokens: 256_000 };
const CONTEXT_262K = { contextWindow: 262_144, maxOutputTokens: 262_144 };

export const MISTRAL_COMPLETION_MODEL_CONTEXT_LIMITS = {
  "codestral-latest": { contextWindow: 256_000, maxOutputTokens: 4_096 },
  "devstral-2512": CONTEXT_262K,
  "devstral-latest": CONTEXT_262K,
  "devstral-medium-2507": CONTEXT_128K,
  "devstral-medium-latest": CONTEXT_262K,
  "devstral-small-2505": CONTEXT_128K,
  "devstral-small-2507": CONTEXT_128K,
  "labs-devstral-small-2512": CONTEXT_256K,
  "magistral-medium-latest": { contextWindow: 128_000, maxOutputTokens: 16_384 },
  "magistral-small": CONTEXT_128K,
  "ministral-3b-latest": CONTEXT_128K,
  "ministral-8b-latest": CONTEXT_128K,
  "mistral-large-2411": { contextWindow: 131_072, maxOutputTokens: 16_384 },
  "mistral-large-2512": CONTEXT_262K,
  "mistral-large-latest": CONTEXT_262K,
  "mistral-medium-2505": { contextWindow: 131_072, maxOutputTokens: 131_072 },
  "mistral-medium-2508": CONTEXT_262K,
  "mistral-medium-2604": CONTEXT_262K,
  "mistral-medium-latest": CONTEXT_262K,
  "mistral-nemo": CONTEXT_128K,
  "mistral-small-2506": { contextWindow: 128_000, maxOutputTokens: 16_384 },
  "mistral-small-2603": CONTEXT_256K,
  "mistral-small-latest": CONTEXT_256K,
  "open-mistral-7b": { contextWindow: 8_000, maxOutputTokens: 8_000 },
  "open-mistral-nemo": CONTEXT_128K,
  "open-mixtral-8x22b": { contextWindow: 64_000, maxOutputTokens: 64_000 },
  "open-mixtral-8x7b": { contextWindow: 32_000, maxOutputTokens: 32_000 },
  "pixtral-12b": CONTEXT_128K,
  "pixtral-large-latest": CONTEXT_128K,
} satisfies Readonly<Record<KnownMistralCompletionModelName, ModelContextLimits>>;

export type KnownMistralEmbeddingModelName = "mistral-embed";

export type MistralEmbeddingModelName = ModelId<KnownMistralEmbeddingModelName>;

export type KnownMistralOcrModelName = "mistral-ocr-latest";

export type MistralOcrModelName = ModelId<KnownMistralOcrModelName>;
