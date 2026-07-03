import { MessageActions, MessageCopy, MessageRegenerate } from "./actions";
import {
  MessageData,
  MessageError,
  MessagePart,
  MessageParts,
  MessageReasoning,
  MessageText,
  MessageTool,
} from "./parts";
import { MessageContent, MessageRoot } from "./root";

export const Message = {
  Root: MessageRoot,
  Content: MessageContent,
  Parts: MessageParts,
  Part: MessagePart,
  Text: MessageText,
  Reasoning: MessageReasoning,
  Tool: MessageTool,
  Data: MessageData,
  Error: MessageError,
  Actions: MessageActions,
  Copy: MessageCopy,
  Regenerate: MessageRegenerate,
} as const;

export type { MessageContextValue, MessagePartContextValue } from "../contexts";
export { useChatContext, useMessage, useMessagePart } from "../contexts";
export type { MessagePartsFilter, MessageToolPart, MessageToolRenderWhen } from "./parts";
