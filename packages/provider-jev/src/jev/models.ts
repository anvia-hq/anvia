import type { ModelId } from "@anvia/core/model-listing";

export const JEV_LATEST = "jev-latest";
export const JEV_PREVIEW = "jev-preview";
export type KnownJevDecisionModelId = typeof JEV_LATEST | typeof JEV_PREVIEW;
export type JevDecisionModelId = ModelId<KnownJevDecisionModelId>;
