import type { ModelId } from "@anvia/core/model-listing";

export const JEV_LATEST = "jev-latest";
export type KnownJevDecisionModelId = typeof JEV_LATEST;
export type JevDecisionModelId = ModelId<KnownJevDecisionModelId>;
