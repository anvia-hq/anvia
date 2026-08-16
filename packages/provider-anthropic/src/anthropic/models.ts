import type { ModelContextLimits } from "@anvia/core/completion";
import type { ModelId } from "@anvia/core/model-listing";

export type KnownAnthropicCompletionModelId =
  | "claude-3-5-sonnet-20240620"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-7-sonnet-20250219"
  | "claude-3-haiku-20240307"
  | "claude-3-opus-20240229"
  | "claude-3-sonnet-20240229"
  | "claude-fable-5"
  | "claude-haiku-4-5"
  | "claude-haiku-4-5-20251001"
  | "claude-opus-4-0"
  | "claude-opus-4-1"
  | "claude-opus-4-1-20250805"
  | "claude-opus-4-20250514"
  | "claude-opus-4-5"
  | "claude-opus-4-5-20251101"
  | "claude-opus-4-6"
  | "claude-opus-4-7"
  | "claude-opus-4-8"
  | "claude-sonnet-4-0"
  | "claude-sonnet-4-20250514"
  | "claude-sonnet-4-5"
  | "claude-sonnet-4-5-20250929"
  | "claude-sonnet-4-6"
  | "claude-sonnet-5";

export type AnthropicCompletionModelId = ModelId<KnownAnthropicCompletionModelId>;

const CONTEXT_200K_32K = { contextWindow: 200_000, maxOutputTokens: 32_000 };
const CONTEXT_200K_64K = { contextWindow: 200_000, maxOutputTokens: 64_000 };
const CONTEXT_1M_128K = { contextWindow: 1_000_000, maxOutputTokens: 128_000 };

export const ANTHROPIC_COMPLETION_MODEL_CONTEXT_LIMITS = {
  "claude-3-5-sonnet-20240620": { contextWindow: 200_000, maxOutputTokens: 8_192 },
  "claude-3-5-sonnet-20241022": { contextWindow: 200_000, maxOutputTokens: 8_192 },
  "claude-3-7-sonnet-20250219": CONTEXT_200K_64K,
  "claude-3-haiku-20240307": { contextWindow: 200_000, maxOutputTokens: 4_096 },
  "claude-3-opus-20240229": { contextWindow: 200_000, maxOutputTokens: 4_096 },
  "claude-3-sonnet-20240229": { contextWindow: 200_000, maxOutputTokens: 4_096 },
  "claude-fable-5": CONTEXT_1M_128K,
  "claude-haiku-4-5": CONTEXT_200K_64K,
  "claude-haiku-4-5-20251001": CONTEXT_200K_64K,
  "claude-opus-4-0": CONTEXT_200K_32K,
  "claude-opus-4-1": CONTEXT_200K_32K,
  "claude-opus-4-1-20250805": CONTEXT_200K_32K,
  "claude-opus-4-20250514": CONTEXT_200K_32K,
  "claude-opus-4-5": CONTEXT_200K_64K,
  "claude-opus-4-5-20251101": CONTEXT_200K_64K,
  "claude-opus-4-6": CONTEXT_1M_128K,
  "claude-opus-4-7": CONTEXT_1M_128K,
  "claude-opus-4-8": CONTEXT_1M_128K,
  "claude-sonnet-4-0": CONTEXT_200K_64K,
  "claude-sonnet-4-20250514": CONTEXT_200K_64K,
  "claude-sonnet-4-5": CONTEXT_200K_64K,
  "claude-sonnet-4-5-20250929": CONTEXT_200K_64K,
  "claude-sonnet-4-6": { contextWindow: 1_000_000, maxOutputTokens: 64_000 },
  "claude-sonnet-5": CONTEXT_1M_128K,
} satisfies Readonly<Record<KnownAnthropicCompletionModelId, ModelContextLimits>>;
