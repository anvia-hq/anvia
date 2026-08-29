import {
  defineCompletionModelControls,
  type NoCompletionModelControls,
  type ReasoningEffortControls,
} from "@anvia/core/completion";
import type { AnthropicCompletionModelId } from "./models";

export const ANTHROPIC_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type AnthropicReasoningEffort = (typeof ANTHROPIC_REASONING_EFFORTS)[number];
export type AnthropicReasoningControls = ReasoningEffortControls<AnthropicReasoningEffort>;

type AdvancedEffortModel =
  | "claude-fable-5"
  | "claude-mythos-5"
  | "claude-opus-4-7"
  | "claude-opus-4-8"
  | "claude-opus-5"
  | "claude-sonnet-5";

type MaxEffortModel =
  | AdvancedEffortModel
  | "claude-mythos-preview"
  | "claude-opus-4-6"
  | "claude-sonnet-4-6";

type EffortModel = MaxEffortModel | "claude-opus-4-5" | "claude-opus-4-5-20251101";

export type AnthropicControlsFor<ModelId extends AnthropicCompletionModelId> =
  ModelId extends AdvancedEffortModel
    ? AnthropicReasoningControls
    : ModelId extends MaxEffortModel
      ? ReasoningEffortControls<"low" | "medium" | "high" | "max">
      : ModelId extends EffortModel
        ? ReasoningEffortControls<"low" | "medium" | "high">
        : NoCompletionModelControls;

const STANDARD_CONTROLS = reasoningControls(["low", "medium", "high"] as const);
const MAX_CONTROLS = reasoningControls(["low", "medium", "high", "max"] as const);
const ADVANCED_CONTROLS = reasoningControls(ANTHROPIC_REASONING_EFFORTS);

export function anthropicControlsForModel(modelId: string): AnthropicReasoningControls | undefined {
  if (isAdvancedEffortModel(modelId)) return ADVANCED_CONTROLS;
  if (
    modelId === "claude-mythos-preview" ||
    modelId === "claude-opus-4-6" ||
    modelId === "claude-sonnet-4-6"
  ) {
    return MAX_CONTROLS;
  }
  if (modelId === "claude-opus-4-5" || modelId === "claude-opus-4-5-20251101") {
    return STANDARD_CONTROLS;
  }
  return undefined;
}

function isAdvancedEffortModel(modelId: string): modelId is AdvancedEffortModel {
  return [
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-opus-5",
    "claude-sonnet-5",
  ].includes(modelId as AdvancedEffortModel);
}

function reasoningControls<const Efforts extends readonly AnthropicReasoningEffort[]>(
  efforts: Efforts,
): ReasoningEffortControls<Efforts[number]> {
  return defineCompletionModelControls({
    reasoningEffort: {
      type: "select",
      label: "Reasoning effort",
      description: "Controls how much reasoning the model applies before responding.",
      options: efforts,
      defaultValue: "high" as Efforts[number],
    },
  });
}
