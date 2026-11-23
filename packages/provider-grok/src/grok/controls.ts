import type { NoCompletionModelControls, ReasoningEffortControls } from "@anvia/core/completion";
import { defineReasoningEffortControls } from "@anvia/core/internal/provider";
import type { GrokCompletionModelId, KnownGrokCompletionModelId } from "./models";

export const GROK_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const;

export type GrokReasoningEffort = (typeof GROK_REASONING_EFFORTS)[number];
export type GrokReasoningControls = ReasoningEffortControls<GrokReasoningEffort>;

const GROK_REASONING_CONTROLS = defineReasoningEffortControls(
  ["low", "medium", "high", "xhigh"] as const,
  "high",
);
const GROK_4_5_REASONING_CONTROLS = defineReasoningEffortControls(
  ["low", "medium", "high"] as const,
  "high",
);
const GROK_4_3_REASONING_CONTROLS = defineReasoningEffortControls([
  "none",
  "low",
  "medium",
  "high",
] as const);

const GROK_MODEL_CONTROLS = {
  "grok-4.3": GROK_4_3_REASONING_CONTROLS,
  "grok-4.3-latest": GROK_4_3_REASONING_CONTROLS,
  "grok-4.5": GROK_4_5_REASONING_CONTROLS,
  "grok-4.6": GROK_REASONING_CONTROLS,
  "grok-4.6-latest": GROK_REASONING_CONTROLS,
  "grok-4.7": GROK_REASONING_CONTROLS,
  "grok-4.7-latest": GROK_REASONING_CONTROLS,
  "grok-4.20-multi-agent-0309": GROK_REASONING_CONTROLS,
} as const satisfies Partial<Record<KnownGrokCompletionModelId, GrokReasoningControls>>;

export type GrokControlsFor<ModelId extends GrokCompletionModelId> =
  ModelId extends keyof typeof GROK_MODEL_CONTROLS
    ? (typeof GROK_MODEL_CONTROLS)[ModelId]
    : NoCompletionModelControls;

export function grokControlsForModel(modelId: string): GrokReasoningControls | undefined {
  if (!Object.hasOwn(GROK_MODEL_CONTROLS, modelId)) {
    return undefined;
  }

  return GROK_MODEL_CONTROLS[modelId as keyof typeof GROK_MODEL_CONTROLS];
}
