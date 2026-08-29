import {
  defineCompletionModelControls,
  type NoCompletionModelControls,
  type ReasoningEffortControls,
} from "@anvia/core/completion";
import type { OpenAICompletionModelId } from "./models";

export const OPENAI_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];
export type OpenAIReasoningControls = ReasoningEffortControls<OpenAIReasoningEffort>;

export type OpenAIControlsFor<ModelId extends OpenAICompletionModelId> = ModelId extends "gpt-5-pro"
  ? ReasoningEffortControls<"high">
  : ModelId extends "gpt-5.2-pro" | "gpt-5.4-pro" | "gpt-5.5-pro"
    ? ReasoningEffortControls<"medium" | "high" | "xhigh">
    : ModelId extends `gpt-5.6${string}`
      ? ReasoningEffortControls<"none" | "low" | "medium" | "high" | "xhigh" | "max">
      : ModelId extends `gpt-5.${2 | 4 | 5}${string}`
        ? ReasoningEffortControls<"none" | "low" | "medium" | "high" | "xhigh">
        : ModelId extends `gpt-5.3${string}`
          ? ReasoningEffortControls<"low" | "medium" | "high" | "xhigh">
          : ModelId extends `gpt-5.1${string}`
            ? ReasoningEffortControls<"none" | "low" | "medium" | "high">
            : ModelId extends `gpt-5${string}`
              ? ReasoningEffortControls<"minimal" | "low" | "medium" | "high">
              : ModelId extends `o${number}${string}`
                ? ReasoningEffortControls<"low" | "medium" | "high">
                : NoCompletionModelControls;

const GPT_5_6_REASONING_CONTROLS = reasoningControls(
  ["none", "low", "medium", "high", "xhigh", "max"] as const,
  "medium",
);
const LATE_GPT_5_DEFAULT_NONE_CONTROLS = reasoningControls(
  ["none", "low", "medium", "high", "xhigh"] as const,
  "none",
);
const GPT_5_5_REASONING_CONTROLS = reasoningControls(
  ["none", "low", "medium", "high", "xhigh"] as const,
  "medium",
);
const GPT_5_3_REASONING_CONTROLS = reasoningControls(["low", "medium", "high", "xhigh"] as const);
const GPT_5_1_REASONING_CONTROLS = reasoningControls(
  ["none", "low", "medium", "high"] as const,
  "none",
);
const GPT_5_REASONING_CONTROLS = reasoningControls(
  ["minimal", "low", "medium", "high"] as const,
  "medium",
);
const HIGH_ONLY_REASONING_CONTROLS = reasoningControls(["high"] as const, "high");
const PRO_REASONING_CONTROLS = reasoningControls(["medium", "high", "xhigh"] as const, "high");
const LEGACY_REASONING_CONTROLS = reasoningControls(["low", "medium", "high"] as const, "medium");

export function openAIControlsForModel(modelId: string): OpenAIReasoningControls | undefined {
  if (modelId === "gpt-5-pro") return HIGH_ONLY_REASONING_CONTROLS;
  if (modelId === "gpt-5.2-pro" || modelId === "gpt-5.4-pro" || modelId === "gpt-5.5-pro") {
    return PRO_REASONING_CONTROLS;
  }
  if (modelId.startsWith("gpt-5.6")) return GPT_5_6_REASONING_CONTROLS;
  if (modelId.startsWith("gpt-5.2") || modelId.startsWith("gpt-5.4")) {
    return LATE_GPT_5_DEFAULT_NONE_CONTROLS;
  }
  if (modelId.startsWith("gpt-5.5")) return GPT_5_5_REASONING_CONTROLS;
  if (modelId.startsWith("gpt-5.3")) return GPT_5_3_REASONING_CONTROLS;
  if (modelId.startsWith("gpt-5.1")) return GPT_5_1_REASONING_CONTROLS;
  if (modelId.startsWith("gpt-5")) return GPT_5_REASONING_CONTROLS;
  if (/^o\d/.test(modelId)) return LEGACY_REASONING_CONTROLS;
  return undefined;
}

function reasoningControls<const Efforts extends readonly OpenAIReasoningEffort[]>(
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
