import type { ClientDataMap, ClientMetadata } from "@anvia/client";
import type { UseCompletionResult } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type CompletionController<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = UseCompletionResult<Metadata, Data>;

export type CompletionProviderProps<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = {
  controller: CompletionController<Metadata, Data>;
  children?: ReactNode;
};

const CompletionContext = createContext<CompletionController | undefined>(undefined);

export function CompletionProvider<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>({ controller, children }: CompletionProviderProps<Metadata, Data>): ReactElement {
  return createElement(
    CompletionContext.Provider,
    { value: controller as unknown as CompletionController },
    children,
  );
}

export function useCompletionContext<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>(): CompletionController<Metadata, Data> {
  const value = useContext(CompletionContext);
  if (value === undefined) {
    throw new Error("Anvia completion primitives must be used inside CompletionProvider.");
  }
  return value as unknown as CompletionController<Metadata, Data>;
}
