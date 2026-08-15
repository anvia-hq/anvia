import type { ClientDataMap } from "@anvia/client";
import type { UseCompletionResult } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type CompletionController<TData extends ClientDataMap = ClientDataMap> =
  UseCompletionResult<TData>;

export type CompletionProviderProps<TData extends ClientDataMap = ClientDataMap> = {
  controller: CompletionController<TData>;
  children?: ReactNode;
};

const CompletionContext = createContext<CompletionController | undefined>(undefined);

export function CompletionProvider<TData extends ClientDataMap = ClientDataMap>({
  controller,
  children,
}: CompletionProviderProps<TData>): ReactElement {
  return createElement(
    CompletionContext.Provider,
    { value: controller as unknown as CompletionController },
    children,
  );
}

export function useCompletionContext<
  TData extends ClientDataMap = ClientDataMap,
>(): CompletionController<TData> {
  const value = useContext(CompletionContext);
  if (value === undefined) {
    throw new Error("Anvia completion primitives must be used inside CompletionProvider.");
  }
  return value as unknown as CompletionController<TData>;
}
