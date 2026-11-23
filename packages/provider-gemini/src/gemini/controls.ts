import {
  defineCompletionModelControls,
  type CompletionModelSelectControl,
  type NoCompletionModelControls,
  type ReasoningEffortControls,
} from "@anvia/core/completion";
import type { GeminiCompletionModelId } from "./models";
import type { Writable } from "./type-utils";

export const GEMINI_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;

export type GeminiReasoningEffort = (typeof GEMINI_REASONING_EFFORTS)[number];
export type GeminiReasoningControls = ReasoningEffortControls<GeminiReasoningEffort>;

type AllLevelModel =
  | "gemini-3-flash-preview"
  | "gemini-3.1-flash-lite"
  | "gemini-3.1-flash-lite-preview"
  | "gemini-3.5-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-3.6-flash";
type LowMediumHighModel =
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "gemini-2.5-pro"
  | "gemini-3.1-pro-preview"
  | "gemini-3.1-pro-preview-customtools"
  | "gemini-3.7-flash"
  | "gemini-3.8-flash"
  | "gemini-4-argon"
  | "gemini-4-carbon";
type LowMediumHighXHighModel = "gemini-4-hydrogen" | "gemini-4-neon";
type MinimalHighModel = "gemini-3.1-flash-lite-image";
type LowHighModel = "gemini-3-pro-preview";

export type GeminiControlsFor<ModelId extends GeminiCompletionModelId> =
  ModelId extends AllLevelModel
    ? ReasoningEffortControls<"minimal" | "low" | "medium" | "high">
    : ModelId extends LowMediumHighXHighModel
      ? ReasoningEffortControls<"low" | "medium" | "high" | "xhigh">
      : ModelId extends LowMediumHighModel
        ? ReasoningEffortControls<"low" | "medium" | "high">
        : ModelId extends MinimalHighModel
          ? ReasoningEffortControls<"minimal" | "high">
          : ModelId extends LowHighModel
            ? ReasoningEffortControls<"low" | "high">
            : NoCompletionModelControls;

const ALL_LEVEL_EFFORTS = ["minimal", "low", "medium", "high"] as const;
const ALL_LEVEL_HIGH_CONTROLS = reasoningControls(ALL_LEVEL_EFFORTS, "high");
const ALL_LEVEL_MEDIUM_CONTROLS = reasoningControls(ALL_LEVEL_EFFORTS, "medium");
const ALL_LEVEL_MINIMAL_CONTROLS = reasoningControls(ALL_LEVEL_EFFORTS, "minimal");
const LOW_MEDIUM_HIGH_CONTROLS = reasoningControls(["low", "medium", "high"] as const);
const LOW_MEDIUM_HIGH_DEFAULT_HIGH_CONTROLS = reasoningControls(
  ["low", "medium", "high"] as const,
  "high",
);
const LOW_MEDIUM_HIGH_DEFAULT_MEDIUM_CONTROLS = reasoningControls(
  ["low", "medium", "high"] as const,
  "medium",
);
const LOW_MEDIUM_HIGH_XHIGH_DEFAULT_HIGH_CONTROLS = reasoningControls(
  ["low", "medium", "high", "xhigh"] as const,
  "high",
);
const MINIMAL_HIGH_CONTROLS = reasoningControls(["minimal", "high"] as const, "minimal");
const LOW_HIGH_CONTROLS = reasoningControls(["low", "high"] as const, "high");

export function geminiControlsForModel(modelId: string): GeminiReasoningControls | undefined {
  if (ALL_LEVEL_HIGH_MODELS.has(modelId)) return ALL_LEVEL_HIGH_CONTROLS;

  if (ALL_LEVEL_MEDIUM_MODELS.has(modelId)) return ALL_LEVEL_MEDIUM_CONTROLS;

  if (ALL_LEVEL_MINIMAL_MODELS.has(modelId)) return ALL_LEVEL_MINIMAL_CONTROLS;

  if (GEMINI_2_5_MODELS.has(modelId)) return LOW_MEDIUM_HIGH_CONTROLS;

  if (GEMINI_PRO_MODELS.has(modelId)) return LOW_MEDIUM_HIGH_DEFAULT_HIGH_CONTROLS;

  if (GEMINI_MEDIUM_DEFAULT_MODELS.has(modelId)) return LOW_MEDIUM_HIGH_DEFAULT_MEDIUM_CONTROLS;

  if (GEMINI_XHIGH_DEFAULT_HIGH_MODELS.has(modelId)) {
    return LOW_MEDIUM_HIGH_XHIGH_DEFAULT_HIGH_CONTROLS;
  }

  if (modelId === "gemini-3.1-flash-lite-image") return MINIMAL_HIGH_CONTROLS;

  if (modelId === "gemini-3-pro-preview") return LOW_HIGH_CONTROLS;

  return undefined;
}

const ALL_LEVEL_HIGH_MODELS = new Set<string>(["gemini-3-flash-preview"]);
const ALL_LEVEL_MEDIUM_MODELS = new Set<string>(["gemini-3.5-flash", "gemini-3.6-flash"]);
const ALL_LEVEL_MINIMAL_MODELS = new Set<string>([
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.5-flash-lite",
]);
const GEMINI_2_5_MODELS = new Set<string>([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
]);
const GEMINI_PRO_MODELS = new Set<string>([
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
]);
const GEMINI_MEDIUM_DEFAULT_MODELS = new Set<string>([
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-4-argon",
  "gemini-4-carbon",
]);
const GEMINI_XHIGH_DEFAULT_HIGH_MODELS = new Set<string>(["gemini-4-hydrogen", "gemini-4-neon"]);

function reasoningControls<const Efforts extends readonly GeminiReasoningEffort[]>(
  efforts: Efforts,
  defaultValue?: Efforts[number],
): ReasoningEffortControls<Efforts[number]> {
  const effortControl: Writable<CompletionModelSelectControl<Efforts[number]>> = {
    type: "select",
    label: "Reasoning effort",
    description: "Controls how much reasoning the model applies before responding.",
    options: efforts,
  };

  if (defaultValue !== undefined) effortControl.defaultValue = defaultValue;

  return defineCompletionModelControls({
    reasoningEffort: effortControl,
  });
}
