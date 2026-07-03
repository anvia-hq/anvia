import {
  createContext,
  createElement,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";

export type ThreadContextValue = {
  viewportRef: MutableRefObject<HTMLElement | null>;
  atBottom: boolean;
  setAtBottom(atBottom: boolean): void;
  scrollToBottom(behavior?: ScrollBehavior): void;
};

const ThreadContext = createContext<ThreadContextValue | undefined>(undefined);

export function InternalThreadProvider({
  value,
  children,
}: {
  value: ThreadContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(ThreadContext.Provider, { value }, children);
}

export function useThread(): ThreadContextValue {
  const value = useContext(ThreadContext);
  if (value === undefined) {
    throw new Error("Thread primitives must be used inside Thread.Root.");
  }
  return value;
}
