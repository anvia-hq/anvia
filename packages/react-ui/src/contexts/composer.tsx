import type { CreateUIAttachment, UIAttachment } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";
import type { ChatController } from "./chat";

export type ComposerEntityData =
  | string
  | number
  | boolean
  | null
  | ComposerEntityData[]
  | { [key: string]: ComposerEntityData | undefined };

export type ComposerAttachmentInput = File | CreateUIAttachment;
export type ComposerAttachmentsUpdate =
  | UIAttachment[]
  | ((attachments: UIAttachment[]) => UIAttachment[]);
export type ComposerEntitiesUpdate =
  | ComposerEntity[]
  | ((entities: ComposerEntity[]) => ComposerEntity[]);
export type ComposerQuote = {
  text: string;
  messageId: string;
};
export type ComposerTriggerItem = {
  id: string;
  label: string;
  text?: string | undefined;
  detail?: ReactNode | undefined;
  data?: ComposerEntityData | undefined;
  disabled?: boolean | undefined;
};
export type ComposerTriggerItemsArgs = {
  trigger: ComposerTriggerDefinition;
  query: string;
  input: string;
  entities: ComposerEntity[];
  signal: AbortSignal;
};
export type ComposerTriggerItems =
  | ComposerTriggerItem[]
  | ((args: ComposerTriggerItemsArgs) => ComposerTriggerItem[] | Promise<ComposerTriggerItem[]>);
export type ComposerTriggerDefinition = {
  id: string;
  char: string;
  items: ComposerTriggerItems;
  minQueryLength?: number | undefined;
  allowedPrefixes?: string[] | null | undefined;
  startOfLine?: boolean | undefined;
  allowSpaces?: boolean | undefined;
};
export type ComposerEntity = {
  id: string;
  triggerId: string;
  trigger: string;
  label: string;
  text: string;
  range: {
    from: number;
    to: number;
  };
  data?: ComposerEntityData | undefined;
};
export type ComposerTriggerState = {
  trigger: ComposerTriggerDefinition;
  query: string;
  items: ComposerTriggerItem[];
  loading: boolean;
  selectedIndex: number;
  rect?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
  };
  selectItem(item: ComposerTriggerItem): void;
  setSelectedIndex(index: number): void;
};
export type ComposerTriggerStateUpdate =
  | ComposerTriggerState
  | undefined
  | ((state: ComposerTriggerState | undefined) => ComposerTriggerState | undefined);

export type ComposerContextValue = {
  input: string;
  setInput(input: string): void;
  attachments: UIAttachment[];
  setAttachments(update: ComposerAttachmentsUpdate): void;
  addAttachment(attachment: ComposerAttachmentInput): Promise<void>;
  removeAttachment(id: string): void;
  clearAttachments(): void;
  entities: ComposerEntity[];
  setEntities(update: ComposerEntitiesUpdate): void;
  quote?: ComposerQuote | undefined;
  setQuote(quote: ComposerQuote | undefined): void;
  clearQuote(): void;
  triggers: ComposerTriggerDefinition[];
  activeTrigger?: ComposerTriggerState | undefined;
  setActiveTrigger(update: ComposerTriggerStateUpdate): void;
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
