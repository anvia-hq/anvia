import type { ModelContextLimits } from "@anvia/core/completion";
import type { ModelId } from "@anvia/core/model-listing";

export type KnownGrokCompletionModelName =
  | "grok-4.5"
  | "grok-4.20"
  | "grok-4.20-0309-non-reasoning"
  | "grok-4.20-0309-reasoning"
  | "grok-4.20-multi-agent-0309"
  | "grok-4.20-non-reasoning"
  | "grok-4.3"
  | "grok-build-0.1";

export type GrokCompletionModelName = ModelId<KnownGrokCompletionModelName>;

const CONTEXT_1M_30K = { contextWindow: 1_000_000, maxOutputTokens: 30_000 };

export const GROK_COMPLETION_MODEL_CONTEXT_LIMITS = {
  "grok-4.5": { contextWindow: 500_000 },
  "grok-4.20": CONTEXT_1M_30K,
  "grok-4.20-0309-non-reasoning": CONTEXT_1M_30K,
  "grok-4.20-0309-reasoning": CONTEXT_1M_30K,
  "grok-4.20-multi-agent-0309": CONTEXT_1M_30K,
  "grok-4.20-non-reasoning": CONTEXT_1M_30K,
  "grok-4.3": CONTEXT_1M_30K,
  "grok-build-0.1": { contextWindow: 256_000, maxOutputTokens: 256_000 },
} satisfies Readonly<Record<KnownGrokCompletionModelName, ModelContextLimits>>;

export type KnownGrokImageGenerationModelName = "grok-imagine-image" | "grok-imagine-image-quality";

export type GrokImageGenerationModelName = ModelId<KnownGrokImageGenerationModelName>;
