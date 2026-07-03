import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

import type { CompletionController } from "./completion";

export type CompletionInputContextValue = {
  input: string;
  setInput(input: string): void;
  submit(): Promise<void>;
  stop(): void;
  status: CompletionController["status"];
  canSubmit: boolean;
  canStop: boolean;
};

const CompletionInputContext = createContext<CompletionInputContextValue | undefined>(undefined);

export function InternalCompletionInputProvider({
  value,
  children,
}: {
  value: CompletionInputContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(CompletionInputContext.Provider, { value }, children);
}

export function useCompletionInput(): CompletionInputContextValue {
  const value = useContext(CompletionInputContext);
  if (value === undefined) {
    throw new Error("Completion input primitives must be used inside Completion.Form.");
  }
  return value;
}
