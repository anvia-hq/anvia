import type { JsonValue, Usage } from "../completion/types";

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
