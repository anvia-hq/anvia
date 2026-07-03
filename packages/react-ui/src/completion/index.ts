import { CompletionForm, CompletionInput, CompletionStop, CompletionSubmit } from "./form";
import { CompletionOutput, CompletionRoot } from "./root";

export const Completion = {
  Root: CompletionRoot,
  Output: CompletionOutput,
  Form: CompletionForm,
  Input: CompletionInput,
  Submit: CompletionSubmit,
  Stop: CompletionStop,
} as const;

export type {
  CompletionController,
  CompletionInputContextValue,
  CompletionProviderProps,
} from "../contexts";
export { CompletionProvider, useCompletionContext, useCompletionInput } from "../contexts";
