import type { ClientDataMap } from "@anvia/client";
import type { UseChatResult } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type ChatController<TData extends ClientDataMap = ClientDataMap> = UseChatResult<TData>;

export type ChatProviderProps<TData extends ClientDataMap = ClientDataMap> = {
  controller: ChatController<TData>;
  children?: ReactNode;
};

const ChatContext = createContext<ChatController | undefined>(undefined);

export function ChatProvider<TData extends ClientDataMap = ClientDataMap>({
  controller,
  children,
}: ChatProviderProps<TData>): ReactElement {
  return createElement(
    ChatContext.Provider,
    { value: controller as unknown as ChatController },
    children,
  );
}

export function useChatContext<
  TData extends ClientDataMap = ClientDataMap,
>(): ChatController<TData> {
  const value = useContext(ChatContext);
  if (value === undefined) {
    throw new Error("Anvia chat primitives must be used inside ChatProvider.");
  }
  return value as unknown as ChatController<TData>;
}

export function useHumanInput(): ChatController["humanInput"] {
  return useChatContext().humanInput;
}
