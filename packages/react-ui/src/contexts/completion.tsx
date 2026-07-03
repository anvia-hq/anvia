import type { UseCompletionResult } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type CompletionController<TEvent = unknown> = UseCompletionResult<TEvent>;

export type CompletionProviderProps<TEvent = unknown> = {
  controller: CompletionController<TEvent>;
  children?: ReactNode;
};

const CompletionContext = createContext<CompletionController | undefined>(undefined);

export function CompletionProvider<TEvent = unknown>({
  controller,
  children,
}: CompletionProviderProps<TEvent>): ReactElement {
  return createElement(
    CompletionContext.Provider,
    { value: controller as CompletionController },
    children,
  );
}

export function useCompletionContext<TEvent = unknown>(): CompletionController<TEvent> {
  const value = useContext(CompletionContext);
  if (value === undefined) {
    throw new Error("Anvia completion primitives must be used inside CompletionProvider.");
  }
  return value as CompletionController<TEvent>;
}
