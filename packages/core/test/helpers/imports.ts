export * from "../../src/agent";
export * from "../../src/completion";
export * from "../../src/embeddings";
export * from "../../src/evals";
export * from "../../src/extractor";
export * from "../../src/guardrails";
export * from "../../src/hooks";
export * from "../../src/image-generation";
export * from "../../src/internal/agent";
export * from "../../src/mcp";
export * from "../../src/memory";
export * from "../../src/model-listing";
export * from "../../src/observability";

import type { AgentObserver } from "../../src/observability";

export function createObserver(observer: AgentObserver): AgentObserver {
  return observer;
}
export * from "../../src/pipeline";
export * from "../../src/skills";
export * from "../../src/speech-generation";
export * from "../../src/streaming";
export * from "../../src/tool";
export * from "../../src/transcription";
export * from "../../src/vector-store";

import type {
  AssistantContentPart,
  AssistantMessage,
  Message as CoreMessage,
  ImagePart,
  JsonObject,
  JsonValue,
  ReasoningDetail,
  ReasoningPart,
  TextPart,
  ToolCallPart,
  ToolMessage,
  ToolResultContentPart,
  ToolResultPart,
  UserContentPart,
  UserMessage,
} from "../../src/completion";

export type Message = CoreMessage;

/** Test fixtures use concise builders without reintroducing them into the public API. */
export const AssistantContent = {
  text(text: string): TextPart {
    return { type: "text", text };
  },
  reasoning(text: string, id?: string): ReasoningPart {
    let part: ReasoningPart = { type: "reasoning", text };
    if (id !== undefined) part = { ...part, id };
    return part;
  },
  reasoningFromContent(details: readonly ReasoningDetail[], id?: string): ReasoningPart {
    const text = details
      .flatMap((detail) =>
        detail.type === "text" || detail.type === "summary" ? [detail.text] : [],
      )
      .join("");
    let part: ReasoningPart = { type: "reasoning", text, details };
    if (id !== undefined) part = { ...part, id };
    return part;
  },
  reasoningSummary(text: string, id?: string): ReasoningPart {
    let part: ReasoningPart = {
      type: "reasoning",
      text,
      details: [{ type: "summary", text }],
    };
    if (id !== undefined) part = { ...part, id };
    return part;
  },
  toolCall(toolCallId: string, toolName: string, input: JsonValue, callId?: string): ToolCallPart {
    let part: ToolCallPart = {
      type: "tool-call",
      toolCallId,
      toolName,
      input,
    };
    if (callId !== undefined) part = { ...part, callId };
    return part;
  },
  imageBase64(data: string, mediaType: string): ImagePart {
    return { type: "image", image: { type: "data", data }, mediaType };
  },
};

export const UserContent = {
  text(text: string): UserContentPart {
    return { type: "text", text };
  },
  imageUrl(url: string, options?: { detail?: "auto" | "low" | "high" }): UserContentPart {
    return { type: "image", image: { type: "url", url }, ...options };
  },
  imageBase64(
    data: string,
    mediaType: string,
    options?: { detail?: "auto" | "low" | "high" },
  ): UserContentPart {
    return { type: "image", image: { type: "data", data }, mediaType, ...options };
  },
  documentBase64(
    data: string,
    mediaType: string,
    options?: { filename?: string },
  ): UserContentPart {
    return { type: "file", data: { type: "data", data }, mediaType, ...options };
  },
  documentUrl(
    url: string,
    mediaType = "application/octet-stream",
    options?: { filename?: string },
  ): UserContentPart {
    return { type: "file", data: { type: "url", url }, mediaType, ...options };
  },
  documentText(
    text: string,
    mediaType = "text/plain",
    options?: { filename?: string },
  ): UserContentPart {
    return { type: "file", data: { type: "text", text }, mediaType, ...options };
  },
};

export const ToolContent = {
  toolResult(
    toolCallId: string,
    value: JsonValue | readonly ToolResultContentPart[],
    options?: string | { callId?: string; toolName?: string },
    positionalToolName = "tool",
  ): ToolResultPart {
    const callId = typeof options === "string" ? options : options?.callId;
    const toolName =
      typeof options === "object" ? (options.toolName ?? "tool") : positionalToolName;
    let part: ToolResultPart = {
      type: "tool-result",
      toolCallId,
      toolName,
      output:
        typeof value === "string"
          ? { type: "text", value }
          : Array.isArray(value)
            ? { type: "content", value: value as unknown as readonly ToolResultContentPart[] }
            : { type: "json", value: value as JsonValue },
    };
    if (callId !== undefined) part = { ...part, callId };
    return part;
  },
};

export const Message = {
  system(content: string, options?: { metadata?: JsonObject }): CoreMessage {
    return { role: "system", content, ...options };
  },
  user(
    content: string | readonly UserContentPart[],
    options?: { metadata?: JsonObject },
  ): UserMessage {
    return {
      role: "user",
      content,
      ...options,
    };
  },
  assistant(
    content: string | readonly AssistantContentPart[],
    options?: string | { id?: string; metadata?: JsonObject },
  ): AssistantMessage {
    const normalized = typeof options === "string" ? { id: options } : options;
    return {
      role: "assistant",
      content: typeof content === "string" ? [{ type: "text", text: content }] : content,
      ...normalized,
    };
  },
  tool(content: unknown, options?: { metadata?: JsonObject }): ToolMessage {
    const values = Array.isArray(content) ? content : [content];
    return { role: "tool", content: values.map(normalizeToolResult), ...options };
  },
  toolResult(
    toolCallId: string,
    value: JsonValue | readonly ToolResultContentPart[],
    options?: { callId?: string; toolName?: string; metadata?: JsonObject },
  ): ToolMessage {
    const toolResultOptions: { callId?: string; toolName: string } = {
      toolName: options?.toolName ?? "tool",
    };
    if (options?.callId !== undefined) toolResultOptions.callId = options.callId;
    let message: ToolMessage = {
      role: "tool",
      content: [ToolContent.toolResult(toolCallId, value, toolResultOptions)],
    };
    if (options?.metadata !== undefined) message = { ...message, metadata: options.metadata };
    return message;
  },
};

function normalizeToolResult(value: unknown): ToolResultPart {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Invalid test tool result fixture");
  }
  if ("type" in value && value.type === "tool-result") {
    return value as ToolResultPart;
  }
  const legacy = value as {
    id?: string;
    callId?: string;
    toolName?: string;
    content?: unknown;
  };
  const legacyContent = Array.isArray(legacy.content)
    ? legacy.content
    : typeof legacy.content === "object" &&
        legacy.content !== null &&
        "content" in legacy.content &&
        Array.isArray(legacy.content.content)
      ? legacy.content.content
      : [];
  const content = legacyContent.map((part): ToolResultContentPart => {
    if (typeof part !== "object" || part === null) {
      throw new TypeError("Invalid test tool result content fixture");
    }
    if ("type" in part && part.type === "image") {
      const image = part as { data?: string; mediaType?: string };
      return {
        type: "file",
        data: { type: "data", data: image.data ?? "" },
        mediaType: image.mediaType ?? "image/png",
      };
    }
    return part as ToolResultContentPart;
  });
  const text = content.length === 1 && content[0]?.type === "text" ? content[0].text : undefined;
  const output =
    text?.startsWith("ToolCallError:") === true
      ? ({ type: "error-text", value: text } as const)
      : text === "Rejected by hook." ||
          text === "Tool approval was rejected." ||
          text === "Not allowed."
        ? ({ type: "execution-denied", reason: text } as const)
        : text !== undefined
          ? numericJsonOutput(text)
          : ({ type: "content", value: content } as const);
  let result: ToolResultPart = {
    type: "tool-result",
    toolCallId: legacy.id ?? "tool",
    toolName: legacy.toolName ?? "tool",
    output,
  };
  if (legacy.callId !== undefined) result = { ...result, callId: legacy.callId };
  return result;
}

function numericJsonOutput(
  text: string,
): { type: "text"; value: string } | { type: "json"; value: JsonValue } {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
    return { type: "text", value: text };
  }
  return { type: "json", value: JSON.parse(text) as JsonValue };
}

export type ToolCall = Extract<AssistantContentPart, { type: "tool-call" }>;

import type { AgentResponse, AgentResult } from "../../src/agent";

export function assertCompleted(result: AgentResult): asserts result is AgentResponse {
  if (result.status !== "completed") {
    throw new Error(`Expected completed agent result, received ${result.status}`);
  }
}
