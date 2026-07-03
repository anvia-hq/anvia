import type { CreateUIAttachment, UIAttachment } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";
import type { ChatController } from "./chat";

export type ComposerAttachmentInput = File | CreateUIAttachment;
export type ComposerAttachmentsUpdate =
  | UIAttachment[]
  | ((attachments: UIAttachment[]) => UIAttachment[]);

export type ComposerContextValue = {
  input: string;
  setInput(input: string): void;
  attachments: UIAttachment[];
  setAttachments(update: ComposerAttachmentsUpdate): void;
  addAttachment(attachment: ComposerAttachmentInput): Promise<void>;
  removeAttachment(id: string): void;
  clearAttachments(): void;
  submit(): Promise<void>;
  stop(): void;
  status: ChatController["status"];
  canSubmit: boolean;
  canStop: boolean;
};

const ComposerContext = createContext<ComposerContextValue | undefined>(undefined);

export function InternalComposerProvider({
  value,
  children,
}: {
  value: ComposerContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(ComposerContext.Provider, { value }, children);
}

export function useComposer(): ComposerContextValue {
  const value = useContext(ComposerContext);
  if (value === undefined) {
    throw new Error("Composer primitives must be used inside Composer.Root.");
  }
  return value;
}
