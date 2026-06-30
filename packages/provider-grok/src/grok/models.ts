import type { ModelId } from "@anvia/core/model-listing";

export type KnownGrokCompletionModelName =
  | "grok-4.20"
  | "grok-4.20-0309-non-reasoning"
  | "grok-4.20-0309-reasoning"
  | "grok-4.20-multi-agent-0309"
  | "grok-4.20-non-reasoning"
  | "grok-4.3"
  | "grok-build-0.1";

export type GrokCompletionModelName = ModelId<KnownGrokCompletionModelName>;

export type KnownGrokImageGenerationModelName = "grok-imagine-image" | "grok-imagine-image-quality";

export type GrokImageGenerationModelName = ModelId<KnownGrokImageGenerationModelName>;
