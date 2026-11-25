import type {
  ClientDataMap,
  ClientMetadata,
  ClientStreamRequest,
  ClientTransport,
} from "@anvia/client";
import type {
  AgentToolApprovalRequest,
  AgentToolQuestionRequest,
} from "@anvia/core/agent/interactions";
import type { UseChatOptions, UseChatResult } from "../types";
import { useChat } from "../use-chat";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type ChatController<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = UseChatResult<ClientTransport<ClientStreamRequest, Data, Metadata>>;

type ChatTransport<Metadata extends ClientMetadata, Data extends ClientDataMap> = ClientTransport<
  ClientStreamRequest,
  Data,
  Metadata
>;

export type ChatProviderControllerProps<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = {
  controller: ChatController<Metadata, Data>;
  transport?: never;
  children?: ReactNode;
};

/**
 * Let the provider create the chat with `useChat`. Accepts the same options as `useChat`; read the
 * controller with `useChatContext()`.
 */
export type ChatProviderTransportProps<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = UseChatOptions<ChatTransport<Metadata, Data>> & {
  controller?: never;
  children?: ReactNode;
};

export type ChatProviderProps<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = ChatProviderControllerProps<Metadata, Data> | ChatProviderTransportProps<Metadata, Data>;

const ChatContext = createContext<ChatController | undefined>(undefined);

export function ChatProvider<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>(props: ChatProviderProps<Metadata, Data>): ReactElement {
  if (props.controller !== undefined) {
    return createElement(
      ChatControllerProvider,
      { controller: props.controller as unknown as ChatController },
      props.children,
    );
  }

  return createElement(ChatTransportProvider, props as unknown as ChatProviderTransportProps);
}

function ChatControllerProvider({
  controller,
  children,
}: {
  controller: ChatController;
  children?: ReactNode;
}): ReactElement {
  return createElement(ChatContext.Provider, { value: controller }, children);
}

function ChatTransportProvider({ children, ...options }: ChatProviderTransportProps): ReactElement {
  const controller = useChat(
    options as UseChatOptions<ChatTransport<ClientMetadata, ClientDataMap>>,
  );
  return createElement(
    ChatControllerProvider,
    { controller: controller as unknown as ChatController },
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

export function useHumanInput() {
  const interactions = useChatContext().interactions;
  const approvals = interactions.all.filter(
    (item): item is typeof item & { request: AgentToolApprovalRequest } =>
      item.request.type === "tool-approval",
  );
  const questions = interactions.all.filter(
    (item): item is typeof item & { request: AgentToolQuestionRequest } =>
      item.request.type === "tool-question",
  );
  return {
    approvals: {
      all: approvals,
      pending: approvals.filter((item) => item.status === "pending"),
    },
    questions: {
      all: questions,
      pending: questions.filter((item) => item.status === "pending"),
    },
  };
}
