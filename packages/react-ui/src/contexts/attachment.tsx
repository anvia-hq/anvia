import type { UIAttachment } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type AttachmentContextValue = {
  attachment: UIAttachment;
  remove?(): void;
};

const AttachmentContext = createContext<AttachmentContextValue | undefined>(undefined);

export function InternalAttachmentProvider({
  value,
  children,
}: {
  value: AttachmentContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(AttachmentContext.Provider, { value }, children);
}

export function useAttachment(): AttachmentContextValue {
  const value = useContext(AttachmentContext);
  if (value === undefined) {
    throw new Error("Attachment primitives must be used inside Attachment.Root.");
  }
  return value;
}

export function useOptionalAttachment(): AttachmentContextValue | undefined {
  return useContext(AttachmentContext);
}
