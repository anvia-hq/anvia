import {
  defineCompletionModelControls,
  type NoCompletionModelControls,
  type ReasoningEffortControls,
} from "@anvia/core/completion";
import type { GrokCompletionModelId } from "./models";

export const GROK_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const;

export type GrokReasoningEffort = (typeof GROK_REASONING_EFFORTS)[number];
export type GrokReasoningControls = ReasoningEffortControls<GrokReasoningEffort>;

export type GrokControlsFor<ModelId extends GrokCompletionModelId> = ModelId extends
  | "grok-4.6"
  | "grok-4.6-latest"
  | "grok-4.20-multi-agent-0309"
  ? ReasoningEffortControls<"low" | "medium" | "high" | "xhigh">
  : ModelId extends "grok-4.5"
    ? ReasoningEffortControls<"low" | "medium" | "high">
    : ModelId extends "grok-4.3" | "grok-4.3-latest"
      ? ReasoningEffortControls<"none" | "low" | "medium" | "high">
      : NoCompletionModelControls;

const GROK_REASONING_CONTROLS = reasoningControls(
  ["low", "medium", "high", "xhigh"] as const,
  "high",
);
const GROK_4_5_REASONING_CONTROLS = reasoningControls(["low", "medium", "high"] as const, "high");
const GROK_4_3_REASONING_CONTROLS = reasoningControls(["none", "low", "medium", "high"] as const);

export function grokControlsForModel(modelId: string): GrokReasoningControls | undefined {
  if (
    modelId === "grok-4.6" ||
    modelId === "grok-4.6-latest" ||
    modelId === "grok-4.20-multi-agent-0309"
  ) {
    return GROK_REASONING_CONTROLS;
  }
  if (modelId === "grok-4.5") return GROK_4_5_REASONING_CONTROLS;
  if (modelId === "grok-4.3" || modelId === "grok-4.3-latest") {
    return GROK_4_3_REASONING_CONTROLS;
  }
  return undefined;
}

function reasoningControls<const Efforts extends readonly GrokReasoningEffort[]>(
  efforts: Efforts,
  defaultValue?: Efforts[number],
): ReasoningEffortControls<Efforts[number]> {
  return defineCompletionModelControls({
    reasoningEffort: {
      type: "select",
      label: "Reasoning effort",
      description: "Controls how much reasoning the model applies before responding.",
      options: efforts,
      ...(defaultValue === undefined ? {} : { defaultValue }),
    },
  });
}
