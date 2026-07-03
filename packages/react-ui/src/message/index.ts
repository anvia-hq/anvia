import { MessageActions, MessageCopy, MessageRegenerate } from "./actions";
import {
  MessageAttachment,
  MessageCodeBlock,
  MessageData,
  MessageError,
  MessageMarkdown,
  MessagePart,
  MessageParts,
  MessageReasoning,
  MessageText,
  MessageTool,
  MessageToolError,
  MessageToolInput,
  MessageToolName,
  MessageToolOutput,
  MessageToolStatus,
} from "./parts";
import { MessageContent, MessageRoot } from "./root";

export const Message = {
  Root: MessageRoot,
  Content: MessageContent,
  Parts: MessageParts,
  Part: MessagePart,
  Text: MessageText,
  Markdown: MessageMarkdown,
  CodeBlock: MessageCodeBlock,
  Reasoning: MessageReasoning,
  Tool: MessageTool,
  ToolName: MessageToolName,
  ToolInput: MessageToolInput,
  ToolOutput: MessageToolOutput,
  ToolError: MessageToolError,
  ToolStatus: MessageToolStatus,
  Attachment: MessageAttachment,
  Data: MessageData,
  Error: MessageError,
  Actions: MessageActions,
  Copy: MessageCopy,
  Regenerate: MessageRegenerate,
} as const;

export type { MessageContextValue, MessagePartContextValue } from "../contexts";
export { useChatContext, useMessage, useMessagePart } from "../contexts";
export type {
  MessageAttachmentPart,
  MessagePartsFilter,
  MessageToolPart,
  MessageToolRenderWhen,
} from "./parts";
