import type { ModelContextLimits } from "@anvia/core/completion";
import type { ModelId } from "@anvia/core/model-listing";

export type KnownGrokCompletionModelId =
  | "grok-4.5"
  | "grok-4.6"
  | "grok-4.6-latest"
  | "grok-4.20"
  | "grok-4.20-0309-non-reasoning"
  | "grok-4.20-0309-reasoning"
  | "grok-4.20-multi-agent-0309"
  | "grok-4.20-non-reasoning"
  | "grok-4.3"
  | "grok-4.3-latest"
  | "grok-build-0.1";

export type GrokCompletionModelId = ModelId<KnownGrokCompletionModelId>;

const CONTEXT_1M_30K = { contextWindow: 1_000_000, maxOutputTokens: 30_000 };

export const GROK_COMPLETION_MODEL_CONTEXT_LIMITS = {
  "grok-4.5": { contextWindow: 500_000 },
  "grok-4.6": { contextWindow: 500_000 },
  "grok-4.6-latest": { contextWindow: 500_000 },
  "grok-4.20": CONTEXT_1M_30K,
  "grok-4.20-0309-non-reasoning": CONTEXT_1M_30K,
  "grok-4.20-0309-reasoning": CONTEXT_1M_30K,
  "grok-4.20-multi-agent-0309": CONTEXT_1M_30K,
  "grok-4.20-non-reasoning": CONTEXT_1M_30K,
  "grok-4.3": CONTEXT_1M_30K,
  "grok-4.3-latest": CONTEXT_1M_30K,
  "grok-build-0.1": { contextWindow: 256_000, maxOutputTokens: 256_000 },
} satisfies Readonly<Record<KnownGrokCompletionModelId, ModelContextLimits>>;

export type KnownGrokImageGenerationModelId = "grok-imagine-image" | "grok-imagine-image-quality";

export type GrokImageGenerationModelId = ModelId<KnownGrokImageGenerationModelId>;
