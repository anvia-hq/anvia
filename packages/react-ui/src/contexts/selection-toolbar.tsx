import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type SelectionToolbarSelection = {
  text: string;
  messageId: string;
  rect: DOMRect;
};

export type SelectionToolbarContextValue = {
  selection?: SelectionToolbarSelection;
  quote(): void;
  copy(): Promise<void>;
  clear(): void;
};

const SelectionToolbarContext = createContext<SelectionToolbarContextValue | undefined>(undefined);

export function InternalSelectionToolbarProvider({
  value,
  children,
}: {
  value: SelectionToolbarContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(SelectionToolbarContext.Provider, { value }, children);
}

export function useSelectionToolbar(): SelectionToolbarContextValue {
  const value = useContext(SelectionToolbarContext);
  if (value === undefined) {
    throw new Error("SelectionToolbar primitives must be used inside SelectionToolbar.Root.");
  }
  return value;
}
