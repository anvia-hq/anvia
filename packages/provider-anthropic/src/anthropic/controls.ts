import type { NoCompletionModelControls, ReasoningEffortControls } from "@anvia/core/completion";
import { defineReasoningEffortControls } from "@anvia/core/internal/provider";
import type { AnthropicCompletionModelId, KnownAnthropicCompletionModelId } from "./models";

export const ANTHROPIC_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type AnthropicReasoningEffort = (typeof ANTHROPIC_REASONING_EFFORTS)[number];
export type AnthropicReasoningControls = ReasoningEffortControls<AnthropicReasoningEffort>;

const STANDARD_CONTROLS = defineReasoningEffortControls(["low", "medium", "high"] as const, "high");
const MAX_CONTROLS = defineReasoningEffortControls(
  ["low", "medium", "high", "max"] as const,
  "high",
);
const ADVANCED_CONTROLS = defineReasoningEffortControls(ANTHROPIC_REASONING_EFFORTS, "high");
const ADVANCED_MEDIUM_CONTROLS = defineReasoningEffortControls(
  ANTHROPIC_REASONING_EFFORTS,
  "medium",
);

const ANTHROPIC_MODEL_CONTROLS = {
  "claude-fable-5": ADVANCED_CONTROLS,
  "claude-fable-5-1": ADVANCED_CONTROLS,
  "claude-fable-5-2": ADVANCED_CONTROLS,
  "claude-haiku-5-5": ADVANCED_MEDIUM_CONTROLS,
  "claude-mythos-5": ADVANCED_CONTROLS,
  "claude-mythos-5-1": ADVANCED_CONTROLS,
  "claude-mythos-5-2": ADVANCED_CONTROLS,
  "claude-mythos-preview": MAX_CONTROLS,
  "claude-opus-4-5": STANDARD_CONTROLS,
  "claude-opus-4-5-20251101": STANDARD_CONTROLS,
  "claude-opus-4-6": MAX_CONTROLS,
  "claude-opus-4-7": ADVANCED_CONTROLS,
  "claude-opus-4-8": ADVANCED_CONTROLS,
  "claude-opus-5": ADVANCED_CONTROLS,
  "claude-opus-5-5": ADVANCED_MEDIUM_CONTROLS,
  "claude-sonnet-4-6": MAX_CONTROLS,
  "claude-sonnet-5": ADVANCED_CONTROLS,
  "claude-sonnet-5-5": ADVANCED_CONTROLS,
} as const satisfies Partial<Record<KnownAnthropicCompletionModelId, AnthropicReasoningControls>>;

export type AnthropicControlsFor<ModelId extends AnthropicCompletionModelId> =
  ModelId extends keyof typeof ANTHROPIC_MODEL_CONTROLS
    ? (typeof ANTHROPIC_MODEL_CONTROLS)[ModelId]
    : NoCompletionModelControls;

export function anthropicControlsForModel(modelId: string): AnthropicReasoningControls | undefined {
  if (!Object.hasOwn(ANTHROPIC_MODEL_CONTROLS, modelId)) {
    return undefined;
  }

  return ANTHROPIC_MODEL_CONTROLS[modelId as keyof typeof ANTHROPIC_MODEL_CONTROLS];
}
