import type { NoCompletionModelControls, ReasoningEffortControls } from "@anvia/core/completion";
import { defineReasoningEffortControls } from "@anvia/core/internal/provider";
import type { GeminiCompletionModelId, KnownGeminiCompletionModelId } from "./models";

export const GEMINI_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;

export type GeminiReasoningEffort = (typeof GEMINI_REASONING_EFFORTS)[number];
export type GeminiReasoningControls = ReasoningEffortControls<GeminiReasoningEffort>;

const ALL_LEVEL_EFFORTS = ["minimal", "low", "medium", "high"] as const;
const ALL_LEVEL_HIGH_CONTROLS = defineReasoningEffortControls(ALL_LEVEL_EFFORTS, "high");
const ALL_LEVEL_MEDIUM_CONTROLS = defineReasoningEffortControls(ALL_LEVEL_EFFORTS, "medium");
const ALL_LEVEL_MINIMAL_CONTROLS = defineReasoningEffortControls(ALL_LEVEL_EFFORTS, "minimal");
const LOW_MEDIUM_HIGH_CONTROLS = defineReasoningEffortControls(["low", "medium", "high"] as const);
const LOW_MEDIUM_HIGH_DEFAULT_HIGH_CONTROLS = defineReasoningEffortControls(
  ["low", "medium", "high"] as const,
  "high",
);
const LOW_MEDIUM_HIGH_DEFAULT_MEDIUM_CONTROLS = defineReasoningEffortControls(
  ["low", "medium", "high"] as const,
  "medium",
);
const LOW_MEDIUM_HIGH_XHIGH_DEFAULT_HIGH_CONTROLS = defineReasoningEffortControls(
  ["low", "medium", "high", "xhigh"] as const,
  "high",
);
const MINIMAL_HIGH_CONTROLS = defineReasoningEffortControls(
  ["minimal", "high"] as const,
  "minimal",
);
const LOW_HIGH_CONTROLS = defineReasoningEffortControls(["low", "high"] as const, "high");

const GEMINI_MODEL_CONTROLS = {
  "gemini-2.5-flash": LOW_MEDIUM_HIGH_CONTROLS,
  "gemini-2.5-flash-lite": LOW_MEDIUM_HIGH_CONTROLS,
  "gemini-2.5-pro": LOW_MEDIUM_HIGH_CONTROLS,
  "gemini-3-flash-preview": ALL_LEVEL_HIGH_CONTROLS,
  "gemini-3-pro-preview": LOW_HIGH_CONTROLS,
  "gemini-3.1-flash-lite": ALL_LEVEL_MINIMAL_CONTROLS,
  "gemini-3.1-flash-lite-image": MINIMAL_HIGH_CONTROLS,
  "gemini-3.1-flash-lite-preview": ALL_LEVEL_MINIMAL_CONTROLS,
  "gemini-3.1-pro-preview": LOW_MEDIUM_HIGH_DEFAULT_HIGH_CONTROLS,
  "gemini-3.1-pro-preview-customtools": LOW_MEDIUM_HIGH_DEFAULT_HIGH_CONTROLS,
  "gemini-3.5-flash": ALL_LEVEL_MEDIUM_CONTROLS,
  "gemini-3.5-flash-lite": ALL_LEVEL_MINIMAL_CONTROLS,
  "gemini-3.6-flash": ALL_LEVEL_MEDIUM_CONTROLS,
  "gemini-3.7-flash": LOW_MEDIUM_HIGH_DEFAULT_MEDIUM_CONTROLS,
  "gemini-3.8-flash": LOW_MEDIUM_HIGH_DEFAULT_MEDIUM_CONTROLS,
  "gemini-4-argon": LOW_MEDIUM_HIGH_DEFAULT_MEDIUM_CONTROLS,
  "gemini-4-carbon": LOW_MEDIUM_HIGH_DEFAULT_MEDIUM_CONTROLS,
  "gemini-4-hydrogen": LOW_MEDIUM_HIGH_XHIGH_DEFAULT_HIGH_CONTROLS,
  "gemini-4-neon": LOW_MEDIUM_HIGH_XHIGH_DEFAULT_HIGH_CONTROLS,
} as const satisfies Partial<Record<KnownGeminiCompletionModelId, GeminiReasoningControls>>;

export type GeminiControlsFor<ModelId extends GeminiCompletionModelId> =
  ModelId extends keyof typeof GEMINI_MODEL_CONTROLS
    ? (typeof GEMINI_MODEL_CONTROLS)[ModelId]
    : NoCompletionModelControls;

export function geminiControlsForModel(modelId: string): GeminiReasoningControls | undefined {
  if (!Object.hasOwn(GEMINI_MODEL_CONTROLS, modelId)) {
    return undefined;
  }

  return GEMINI_MODEL_CONTROLS[modelId as keyof typeof GEMINI_MODEL_CONTROLS];
}
