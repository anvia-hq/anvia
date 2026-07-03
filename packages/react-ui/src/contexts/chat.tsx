import type { UseChatResult } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type ChatController<TEvent = unknown> = UseChatResult<TEvent>;

export type ChatProviderProps<TEvent = unknown> = {
  controller: ChatController<TEvent>;
  children?: ReactNode;
};

const ChatContext = createContext<ChatController | undefined>(undefined);

export function ChatProvider<TEvent = unknown>({
  controller,
  children,
}: ChatProviderProps<TEvent>): ReactElement {
  return createElement(ChatContext.Provider, { value: controller as ChatController }, children);
}

export function useChatContext<TEvent = unknown>(): ChatController<TEvent> {
  const value = useContext(ChatContext);
  if (value === undefined) {
    throw new Error("Anvia chat primitives must be used inside ChatProvider.");
  }
  return value as ChatController<TEvent>;
}

export function useHumanInput(): ChatController["humanInput"] {
  return useChatContext().humanInput;
}
