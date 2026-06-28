import type { AgentStreamEvent } from "../agent/request-types";
import {
  type Message as CoreMessage,
  type CreateCompletionStreamOptions,
  createCompletionStream,
  type JsonValue,
  serializeToolResultOutput,
  textFromAssistantContent,
} from "../completion";
import type { CompletionStreamEvent, StreamingCompletionModel } from "../completion/types";
import { uiMessagesToCoreMessages } from "./messages";
import type { UIError, UIMessage, UIStreamEvent } from "./types";

export {
  coreMessagesToUIMessages,
  uiMessagesToCoreMessages,
} from "./messages";
export type {
  UIError,
  UIMessage,
  UIMessagePart,
  UIMessageRole,
  UIStreamEvent,
  UIStreamRequest,
} from "./types";

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
