import type { AgentStreamEvent } from "../agent/request-types";
import {
  AssistantContent,
  type AssistantContent as AssistantContentType,
  type Message as CoreMessage,
  type CreateCompletionStreamOptions,
  createCompletionStream,
  type JsonValue,
  Message,
  reasoningDisplayText,
  serializeToolResultOutput,
  ToolContent,
  type ToolContent as ToolContentType,
  textFromAssistantContent,
  type Usage,
  UserContent,
} from "../completion";
import type {
  CompletionStreamEvent,
  StreamingCompletionModel,
  ToolResultContent,
} from "../completion/types";

export type UIMessageRole = "system" | "user" | "assistant" | "tool";

export type UIError = {
  name?: string;
  message: string;
};

export type UIMessage = {
  id: string;
  role: UIMessageRole;
  parts: UIMessagePart[];
  metadata?: JsonValue;
};

export type UIMessagePart =
  | {
      id: string;
      type: "text";
      text: string;
    }
  | {
      id: string;
      type: "reasoning";
      text: string;
      reasoningId?: string;
    }
  | {
      id: string;
      type: "tool";
      toolName: string;
      toolCallId: string;
      callId?: string;
      state: "input-streaming" | "input-available" | "output-available" | "error";
      input?: JsonValue;
      output?: JsonValue;
      error?: UIError;
    }
  | {
      id: string;
      type: "data";
      name: string;
      data: JsonValue;
    }
  | {
      id: string;
      type: "error";
      error: UIError;
    };

export type UIStreamRequest = {
  messages: UIMessage[];
  stream: true;
  metadata?: JsonValue;
};

export type UIStreamEvent =
  | {
      type: "message_start";
      message: UIMessage;
    }
  | {
      type: "text_delta";
      messageId: string;
      partId: string;
      delta: string;
    }
  | {
      type: "reasoning_delta";
      messageId: string;
      partId: string;
      delta: string;
    }
  | {
      type: "tool_update";
      messageId: string;
      partId: string;
      part: UIMessagePart;
    }
  | {
      type: "message_end";
      messageId: string;
      usage?: Usage;
      metadata?: JsonValue;
    }
  | {
      type: "error";
      error: UIError;
    };

export type CreateCompletionUIStreamOptions = Omit<
  CreateCompletionStreamOptions,
  "input" | "messages"
> & {
  messages: UIMessage[];
};

export type AgentLike = {
  prompt(prompt: string | CoreMessage | CoreMessage[]): {
    stream(): AsyncIterable<AgentStreamEvent>;
  };
};

export type CreateAgentUIStreamOptions = {
  messages: UIMessage[];
};

export function uiMessagesToCoreMessages(messages: UIMessage[]): CoreMessage[] {
  const coreMessages: CoreMessage[] = [];

  for (const message of messages) {
    const text = textFromUIParts(message.parts);

    if (message.role === "system") {
      if (text.length > 0) {
        coreMessages.push(Message.system(text));
      }
      continue;
    }

    if (message.role === "user") {
      const content = message.parts
        .filter((part): part is Extract<UIMessagePart, { type: "text" }> => part.type === "text")
        .map((part) => UserContent.text(part.text));
      if (content.length > 0) {
        coreMessages.push(Message.user(content));
      }
      continue;
    }

    if (message.role === "assistant") {
      const content: AssistantContentType[] = [];
      for (const part of message.parts) {
        if (part.type === "text" && part.text.length > 0) {
          content.push(AssistantContent.text(part.text));
          continue;
        }
        if (part.type === "reasoning" && part.text.length > 0) {
          content.push(AssistantContent.reasoning(part.text, part.reasoningId));
          continue;
        }
        if (
          part.type === "tool" &&
          (part.state === "input-streaming" || part.state === "input-available")
        ) {
          content.push(
            AssistantContent.toolCall(
              part.toolCallId,
              part.toolName,
              part.input ?? {},
              part.callId,
            ),
          );
        }
      }
      if (content.length > 0) {
        coreMessages.push(Message.assistant(content, message.id));
      }
      continue;
    }

    const toolResults: ToolContentType[] = [];
    for (const part of message.parts) {
      if (part.type !== "tool" || part.state !== "output-available") {
        continue;
      }
      toolResults.push(
        ToolContent.toolResult(
          part.toolCallId,
          outputToToolResultContent(part.output),
          part.callId,
        ),
      );
    }
    if (toolResults.length > 0) {
      coreMessages.push(Message.tool(toolResults));
    }
  }

  return coreMessages;
}

export function coreMessagesToUIMessages(messages: CoreMessage[]): UIMessage[] {
  const uiMessages: UIMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      uiMessages.push({
        id: createId("msg"),
        role: "system",
        parts: [{ id: createId("part"), type: "text", text: message.content }],
      });
      continue;
    }

    if (message.role === "user") {
      const parts: UIMessagePart[] = [];
      for (const content of message.content) {
        if (content.type === "text") {
          parts.push({ id: createId("part"), type: "text", text: content.text });
        } else {
          parts.push({
            id: createId("part"),
            type: "data",
            name: content.type,
            data: content as JsonValue,
          });
        }
      }
      uiMessages.push({ id: createId("msg"), role: "user", parts });
      continue;
    }

    if (message.role === "assistant") {
      const parts: UIMessagePart[] = [];
      for (const content of message.content) {
        if (content.type === "text") {
          parts.push({ id: createId("part"), type: "text", text: content.text });
          continue;
        }
        if (content.type === "reasoning") {
          const part: UIMessagePart = {
            id: createId("part"),
            type: "reasoning",
            text: reasoningDisplayText(content),
          };
          if (content.id !== undefined) {
            part.reasoningId = content.id;
          }
          parts.push(part);
          continue;
        }
        if (content.type === "tool_call") {
          const part: UIMessagePart = {
            id: toolPartId(content.id),
            type: "tool",
            toolName: content.function.name,
            toolCallId: content.id,
            state: "input-available",
            input: content.function.arguments,
          };
          if (content.callId !== undefined) {
            part.callId = content.callId;
          }
          parts.push(part);
          continue;
        }
        parts.push({
          id: createId("part"),
          type: "data",
          name: content.type,
          data: content as JsonValue,
        });
      }
      uiMessages.push({ id: message.id ?? createId("msg"), role: "assistant", parts });
      continue;
    }

    const parts: UIMessagePart[] = [];
    for (const content of message.content) {
      const part: UIMessagePart = {
        id: toolPartId(content.id),
        type: "tool",
        toolName: "tool",
        toolCallId: content.id,
        state: "output-available",
        output: toolResultContentToJson(content.content),
      };
      if (content.callId !== undefined) {
        part.callId = content.callId;
      }
      parts.push(part);
    }
    uiMessages.push({ id: createId("msg"), role: "tool", parts });
  }

  return uiMessages;
}

export async function* createCompletionUIStream<Model extends StreamingCompletionModel>(
  model: Model,
  options: CreateCompletionUIStreamOptions,
): AsyncIterable<UIStreamEvent> {
  const { messages, ...completionOptions } = options;
  yield* completionStreamToUIStream(
    createCompletionStream(model, {
      ...completionOptions,
      messages: uiMessagesToCoreMessages(messages),
    }),
  );
}

export async function* createAgentUIStream(
  agent: AgentLike,
  options: CreateAgentUIStreamOptions,
): AsyncIterable<UIStreamEvent> {
  yield* agentStreamToUIStream(agent.prompt(uiMessagesToCoreMessages(options.messages)).stream());
}

export async function* completionStreamToUIStream(
  events: AsyncIterable<CompletionStreamEvent>,
  options: { messageId?: string | undefined } = {},
): AsyncIterable<UIStreamEvent> {
  const messageId = options.messageId ?? createId("msg");
  let accumulatedText = "";
  yield messageStart(messageId);

  for await (const event of events) {
    if (event.type === "text_delta") {
      accumulatedText += event.delta;
      yield {
        type: "text_delta",
        messageId,
        partId: textPartId(messageId),
        delta: event.delta,
      };
      continue;
    }

    if (event.type === "reasoning_delta") {
      const partId = reasoningPartId(messageId, event.id);
      yield {
        type: "reasoning_delta",
        messageId,
        partId,
        delta: event.delta,
      };
      continue;
    }

    if (event.type === "tool_call_delta") {
      const partId = toolPartId(event.id);
      yield {
        type: "tool_update",
        messageId,
        partId,
        part: {
          id: partId,
          type: "tool",
          toolName: event.name ?? "",
          toolCallId: event.id,
          ...(event.callId === undefined ? {} : { callId: event.callId }),
          state: "input-streaming",
          ...(event.argumentsDelta === undefined ? {} : { input: event.argumentsDelta }),
        },
      };
      continue;
    }

    if (event.type === "tool_call") {
      yield {
        type: "tool_update",
        messageId,
        partId: toolPartId(event.toolCall.id),
        part: {
          id: toolPartId(event.toolCall.id),
          type: "tool",
          toolName: event.toolCall.function.name,
          toolCallId: event.toolCall.id,
          ...(event.toolCall.callId === undefined ? {} : { callId: event.toolCall.callId }),
          state: "input-available",
          input: event.toolCall.function.arguments,
        },
      };
      continue;
    }

    if (event.type === "final") {
      const finalText = textFromAssistantContent(event.response.choice);
      const missingText = missingTextDelta(accumulatedText, finalText);
      if (missingText !== undefined) {
        accumulatedText += missingText;
        yield {
          type: "text_delta",
          messageId,
          partId: textPartId(messageId),
          delta: missingText,
        };
      }
      const endEvent: UIStreamEvent = {
        type: "message_end",
        messageId,
        usage: event.response.usage,
      };
      if (event.response.messageId !== undefined) {
        endEvent.metadata = { providerMessageId: event.response.messageId };
      }
      yield endEvent;
      continue;
    }

    if (event.type === "error") {
      yield { type: "error", error: uiError(event.error) };
    }
  }
}

export async function* agentStreamToUIStream(
  events: AsyncIterable<AgentStreamEvent>,
  options: { messageId?: string | undefined } = {},
): AsyncIterable<UIStreamEvent> {
  const messageId = options.messageId ?? createId("msg");
  let accumulatedText = "";
  yield messageStart(messageId);

  for await (const event of events) {
    if (event.type === "text_delta") {
      accumulatedText += event.delta;
      yield {
        type: "text_delta",
        messageId,
        partId: textPartId(messageId),
        delta: event.delta,
      };
      continue;
    }

    if (event.type === "reasoning_delta") {
      yield {
        type: "reasoning_delta",
        messageId,
        partId: reasoningPartId(messageId, event.id),
        delta: event.delta,
      };
      continue;
    }

    if (event.type === "tool_call") {
      yield {
        type: "tool_update",
        messageId,
        partId: toolPartId(event.toolCall.id),
        part: {
          id: toolPartId(event.toolCall.id),
          type: "tool",
          toolName: event.toolCall.function.name,
          toolCallId: event.toolCall.id,
          ...(event.toolCall.callId === undefined ? {} : { callId: event.toolCall.callId }),
          state: "input-available",
          input: event.toolCall.function.arguments,
        },
      };
      continue;
    }

    if (event.type === "tool_result") {
      const toolCallId = event.toolCallId ?? event.internalCallId;
      yield {
        type: "tool_update",
        messageId,
        partId: toolPartId(toolCallId),
        part: {
          id: toolPartId(toolCallId),
          type: "tool",
          toolName: event.toolName,
          toolCallId,
          ...(event.toolCallId === undefined ? {} : { callId: event.toolCallId }),
          state: "output-available",
          output:
            event.structuredResult === undefined
              ? event.result
              : (event.structuredResult as JsonValue),
        },
      };
      continue;
    }

    if (event.type === "final") {
      const missingText = missingTextDelta(accumulatedText, event.output);
      if (missingText !== undefined) {
        accumulatedText += missingText;
        yield {
          type: "text_delta",
          messageId,
          partId: textPartId(messageId),
          delta: missingText,
        };
      }
      yield {
        type: "message_end",
        messageId,
        usage: event.usage,
        metadata: { runId: event.runId },
      };
      continue;
    }

    if (event.type === "error") {
      yield { type: "error", error: uiError(event.error) };
    }
  }
}

function messageStart(messageId: string): UIStreamEvent {
  return {
    type: "message_start",
    message: {
      id: messageId,
      role: "assistant",
      parts: [],
    },
  };
}

function textFromUIParts(parts: UIMessagePart[]): string {
  return parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function outputToToolResultContent(output: JsonValue | undefined): ToolResultContent[] {
  return [{ type: "text", text: serializeToolResultOutput(output ?? null) }];
}

function toolResultContentToJson(content: ToolResultContent[]): JsonValue {
  if (content.length === 1 && content[0]?.type === "text") {
    return content[0].text;
  }
  return content as JsonValue;
}

function uiError(error: unknown): UIError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: typeof error === "string" ? error : serializeToolResultOutput(error) };
}

function missingTextDelta(current: string, finalText: string): string | undefined {
  if (finalText.length === 0 || finalText === current) {
    return undefined;
  }
  if (finalText.startsWith(current)) {
    return finalText.slice(current.length);
  }
  return current.length === 0 ? finalText : undefined;
}

function textPartId(messageId: string): string {
  return `${messageId}_text`;
}

function reasoningPartId(messageId: string, id: string | undefined): string {
  return id === undefined ? `${messageId}_reasoning` : `${messageId}_reasoning_${id}`;
}

function toolPartId(toolCallId: string): string {
  return `tool_${toolCallId}`;
}

let nextId = 0;

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random !== undefined) {
    return `${prefix}_${random}`;
  }
  nextId += 1;
  return `${prefix}_${nextId.toString(36)}`;
}
