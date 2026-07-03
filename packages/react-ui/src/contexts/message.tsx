import type { UIMessage, UIMessagePart } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type MessageContextValue = {
  message: UIMessage;
};

export type MessagePartContextValue = {
  part: UIMessagePart;
};

const MessageContext = createContext<MessageContextValue | undefined>(undefined);
const MessagePartContext = createContext<MessagePartContextValue | undefined>(undefined);

export function InternalMessageProvider({
  message,
  children,
}: {
  message: UIMessage;
  children?: ReactNode;
}): ReactElement {
  return createElement(MessageContext.Provider, { value: { message } }, children);
}

export function InternalMessagePartProvider({
  part,
  children,
}: {
  part: UIMessagePart;
  children?: ReactNode;
}): ReactElement {
  return createElement(MessagePartContext.Provider, { value: { part } }, children);
}

export function useMessage(): MessageContextValue {
  const value = useContext(MessageContext);
  if (value === undefined) {
    throw new Error("Message primitives must be used inside Message.Root or Thread.Messages.");
  }
  return value;
}

export function useMessagePart(): MessagePartContextValue {
  const value = useContext(MessagePartContext);
  if (value === undefined) {
    throw new Error("Message part primitives must be used inside Message.Parts or Message.Part.");
  }
  return value;
}
