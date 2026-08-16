import type {
  ClientDataMap,
  ClientMetadata,
  ClientStreamRequest,
  ClientTransport,
} from "@anvia/client";
import type { UseChatResult } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type ChatController<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = UseChatResult<ClientTransport<ClientStreamRequest, Data, Metadata>>;

export type ChatProviderProps<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = {
  controller: ChatController<Metadata, Data>;
  children?: ReactNode;
};

const ChatContext = createContext<ChatController | undefined>(undefined);

export function ChatProvider<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>({ controller, children }: ChatProviderProps<Metadata, Data>): ReactElement {
  return createElement(
    ChatContext.Provider,
    { value: controller as unknown as ChatController },
    children,
  );
}

export function useChatContext<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>(): ChatController<Metadata, Data> {
  const value = useContext(ChatContext);
  if (value === undefined) {
    throw new Error("Anvia chat primitives must be used inside ChatProvider.");
  }
  return value as unknown as ChatController<Metadata, Data>;
}

export function useHumanInput(): ChatController["humanInput"] {
  return useChatContext().humanInput;
}
