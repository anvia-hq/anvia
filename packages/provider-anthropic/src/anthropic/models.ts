import type { ModelId } from "@anvia/core/model-listing";

export type KnownAnthropicCompletionModelName =
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
  | "claude-sonnet-4-6";

export type AnthropicCompletionModelName = ModelId<KnownAnthropicCompletionModelName>;
