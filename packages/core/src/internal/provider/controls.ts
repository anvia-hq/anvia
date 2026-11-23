import {
  defineCompletionModelControls,
  type CompletionModelSelectControl,
  type ReasoningEffortControls,
} from "../../completion/index";
import type { Writable } from "./values";

export function defineReasoningEffortControls<const Efforts extends readonly string[]>(
  efforts: Efforts,
  defaultValue?: Efforts[number],
): ReasoningEffortControls<Efforts[number]> {
  const effortControl: Writable<CompletionModelSelectControl<Efforts[number]>> = {
    type: "select",
    label: "Reasoning effort",
    description: "Controls how much reasoning the model applies before responding.",
    options: efforts,
  };

  if (defaultValue !== undefined) {
    effortControl.defaultValue = defaultValue;
  }

  return defineCompletionModelControls({
    reasoningEffort: effortControl,
  });
}
