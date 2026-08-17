import type {
  ClientDataMap,
  ClientMetadata,
  ClientStreamRequest,
  ClientTransport,
} from "@anvia/client";
import type { AgentToolApprovalRequest, AgentToolQuestionRequest } from "@anvia/core/agent";
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
