import { isJsonValue } from "./json";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export type Document = {
  id: string;
  text: string;
  additionalProps?: Record<string, string>;
};

export type Text = {
  type: "text";
  text: string;
  signature?: string;
};

export type ImageDetail = "auto" | "low" | "high";

export type ImageContent = {
  type: "image";
  source:
    | {
        type: "url";
        url: string;
      }
    | {
        type: "base64";
        data: string;
        mediaType: string;
      };
  detail?: ImageDetail;
};

export type DocumentContent = {
  type: "document";
  source:
    | {
        type: "url";
        url: string;
        mediaType: string;
        filename?: string;
      }
    | {
        type: "base64";
        data: string;
        mediaType: string;
        filename?: string;
      }
    | {
        type: "text";
        text: string;
        mediaType?: string;
        filename?: string;
      };
};

export type Reasoning = {
  type: "reasoning";
  text: string;
  id?: string;
  content?: ReasoningContent[];
};

export type ReasoningContent =
  | {
      type: "text";
      text: string;
      signature?: string;
    }
  | {
      type: "summary";
      text: string;
    }
  | {
      type: "encrypted";
      data: string;
    }
  | {
      type: "redacted";
      data: string;
    };

export type ReasoningContentType = ReasoningContent["type"];

export type ToolFunction = {
  name: string;
  arguments: JsonValue;
};

export type ToolCall = {
  type: "tool_call";
  id: string;
  callId?: string;
  function: ToolFunction;
  signature?: string;
  additionalParams?: JsonValue;
};

export type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType?: string };

export type ToolResult = {
  type: "tool_result";
  id: string;
  callId?: string;
  toolName?: string;
  content: ToolResultContent[];
};

export type MessageOptions = {
  metadata?: JsonValue | undefined;
};

export type AssistantMessageOptions = MessageOptions & {
  id?: string | undefined;
};

export type ToolResultOptions = {
  callId?: string | undefined;
  toolName?: string | undefined;
};

export type ToolResultMessageOptions = ToolResultOptions & MessageOptions;

export type UserContent = Text | ImageContent | DocumentContent;
export type AssistantContent = Text | ToolCall | Reasoning | ImageContent;
export type ToolContent = ToolResult;

export type SystemMessage = {
  role: "system";
  content: string;
  metadata?: JsonValue;
};

export type UserMessage = {
  role: "user";
  content: UserContent[];
  metadata?: JsonValue;
};

export type AssistantMessage = {
  role: "assistant";
  id?: string;
  content: AssistantContent[];
  metadata?: JsonValue;
};

export type ToolMessage = {
  role: "tool";
  content: ToolContent[];
  metadata?: JsonValue;
};

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export const UserContent = {
  text(text: string): Text {
    return { type: "text", text };
  },
  imageUrl(url: string, options: { detail?: ImageDetail } = {}): ImageContent {
    const image: ImageContent = { type: "image", source: { type: "url", url } };
    if (options.detail !== undefined) {
      image.detail = options.detail;
    }
    return image;
  },
  imageBase64(
    data: string,
    mediaType: string,
    options: { detail?: ImageDetail } = {},
  ): ImageContent {
    const image: ImageContent = {
      type: "image",
      source: { type: "base64", data, mediaType },
    };
    if (options.detail !== undefined) {
      image.detail = options.detail;
    }
    return image;
  },
  documentUrl(
    url: string,
    mediaType: string,
    options: { filename?: string | undefined } = {},
  ): DocumentContent {
    return {
      type: "document",
      source:
        options.filename === undefined
          ? { type: "url", url, mediaType }
          : { type: "url", url, mediaType, filename: options.filename },
    };
  },
  documentBase64(
    data: string,
    mediaType: string,
    options: { filename?: string | undefined } = {},
  ): DocumentContent {
    return {
      type: "document",
      source:
        options.filename === undefined
          ? { type: "base64", data, mediaType }
          : { type: "base64", data, mediaType, filename: options.filename },
    };
  },
  documentText(text: string): Text {
    return { type: "text", text };
  },
};

export const ToolContent = {
  toolResult(
    id: string,
    content: string | ToolResultContent[],
    callIdOrOptions?: string | ToolResultOptions,
    toolName?: string,
  ): ToolResult {
    const normalized =
      typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
    const options = normalizeToolResultOptions(callIdOrOptions, toolName);
    const result: ToolResult = { type: "tool_result", id, content: normalized };
    if (options.callId !== undefined) {
      result.callId = options.callId;
    }
    if (options.toolName !== undefined) {
      result.toolName = options.toolName;
    }
    return result;
  },
};

function normalizeToolResultOptions(
  callIdOrOptions?: string | ToolResultOptions,
  toolName?: string,
): ToolResultOptions {
  if (callIdOrOptions === undefined) {
    return toolName === undefined ? {} : { toolName };
  }
  if (typeof callIdOrOptions === "string") {
    return toolName === undefined
      ? { callId: callIdOrOptions }
      : { callId: callIdOrOptions, toolName };
  }
  return toolName === undefined ? callIdOrOptions : { ...callIdOrOptions, toolName };
}

export function serializeToolResultOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  try {
    const serialized = JSON.stringify(output);
    return serialized === undefined ? String(output) : serialized;
  } catch {
    return String(output);
  }
}

export function isToolResultContentArray(value: unknown): value is ToolResultContent[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => {
      if (typeof item !== "object" || item === null || !("type" in item)) {
        return false;
      }
      if (item.type === "text") {
        return "text" in item && typeof item.text === "string";
      }
      if (item.type === "image") {
        return (
          "data" in item &&
          typeof item.data === "string" &&
          (!("mediaType" in item) ||
            item.mediaType === undefined ||
            typeof item.mediaType === "string")
        );
      }
      return false;
    })
  );
}

export const AssistantContent = {
  text(text: string): Text {
    return { type: "text", text };
  },
  imageUrl(url: string, options: { detail?: ImageDetail } = {}): ImageContent {
    const image: ImageContent = { type: "image", source: { type: "url", url } };
    if (options.detail !== undefined) {
      image.detail = options.detail;
    }
    return image;
  },
  imageBase64(
    data: string,
    mediaType: string,
    options: { detail?: ImageDetail } = {},
  ): ImageContent {
    const image: ImageContent = {
      type: "image",
      source: { type: "base64", data, mediaType },
    };
    if (options.detail !== undefined) {
      image.detail = options.detail;
    }
    return image;
  },
  reasoning(text: string, id?: string): Reasoning {
    return id === undefined ? { type: "reasoning", text } : { type: "reasoning", text, id };
  },
  reasoningFromContent(content: ReasoningContent[], id?: string): Reasoning {
    const text = reasoningDisplayText(content);
    const reasoning: Reasoning = { type: "reasoning", text, content };
    return id === undefined ? reasoning : { ...reasoning, id };
  },
  reasoningSummary(text: string, id?: string): Reasoning {
    return AssistantContent.reasoningFromContent([{ type: "summary", text }], id);
  },
  reasoningEncrypted(data: string, id?: string): Reasoning {
    return AssistantContent.reasoningFromContent([{ type: "encrypted", data }], id);
  },
  reasoningRedacted(data: string, id?: string): Reasoning {
    return AssistantContent.reasoningFromContent([{ type: "redacted", data }], id);
  },
  toolCall(id: string, name: string, args: JsonValue, callId?: string): ToolCall {
    const base: ToolCall = {
      type: "tool_call",
      id,
      function: {
        name,
        arguments: args,
      },
    };
    return callId === undefined ? base : { ...base, callId };
  },
};

export function reasoningDisplayText(reasoning: Reasoning | ReasoningContent[]): string {
  const content = Array.isArray(reasoning) ? reasoning : reasoning.content;
  if (content === undefined) {
    return Array.isArray(reasoning) ? "" : reasoning.text;
  }
  return content
    .flatMap((item) => {
      if (item.type === "text" || item.type === "summary") {
        return [item.text];
      }
      return [];
    })
    .join("");
}

export const Message = {
  system(content: string, options: MessageOptions = {}): Message {
    return { role: "system", content, ...messageMetadata(options) };
  },
  user(content: string | UserContent[], options: MessageOptions = {}): Message {
    return {
      role: "user",
      content: typeof content === "string" ? [UserContent.text(content)] : content,
      ...messageMetadata(options),
    };
  },
  assistant(
    content: string | AssistantContent[],
    idOrOptions?: string | AssistantMessageOptions,
  ): Message {
    const normalized = typeof content === "string" ? [AssistantContent.text(content)] : content;
    const options = typeof idOrOptions === "string" ? { id: idOrOptions } : (idOrOptions ?? {});
    const metadata = messageMetadata(options).metadata;
    const message: AssistantMessage =
      options.id === undefined
        ? { role: "assistant", content: normalized }
        : { role: "assistant", id: options.id, content: normalized };
    if (metadata !== undefined) {
      message.metadata = metadata;
    }
    return message;
  },
  tool(content: ToolContent | ToolContent[], options: MessageOptions = {}): Message {
    return {
      role: "tool",
      content: Array.isArray(content) ? content : [content],
      ...messageMetadata(options),
    };
  },
  toolResult(id: string, output: unknown, options: ToolResultMessageOptions = {}): Message {
    const content = isToolResultContentArray(output) ? output : serializeToolResultOutput(output);
    return Message.tool(
      ToolContent.toolResult(id, content, {
        callId: options.callId,
        toolName: options.toolName,
      }),
      { metadata: options.metadata },
    );
  },
};

function messageMetadata(options: MessageOptions): { metadata?: JsonValue } {
  if (options.metadata === undefined) {
    return {};
  }
  if (!isJsonValue(options.metadata)) {
    throw new TypeError("Message metadata must be a strict JSON value.");
  }
  return { metadata: options.metadata };
}

export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | {
      type: "function";
      name: string;
    };

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: JsonObject;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
};

export const Usage = {
  empty(): Usage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  },
  add(left: Usage, right: Usage): Usage {
    return {
      inputTokens: left.inputTokens + right.inputTokens,
      outputTokens: left.outputTokens + right.outputTokens,
      totalTokens: left.totalTokens + right.totalTokens,
      cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
      cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    };
  },
};

export type CompletionRequest<ModelName extends string = string> = {
  model?: ModelName;
  instructions?: string;
  chatHistory: Message[];
  documents: Document[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  toolChoice?: ToolChoice;
  additionalParams?: JsonValue;
  outputSchema?: JsonObject;
};

export type CompletionResponse<RawResponse = unknown> = {
  choice: AssistantContent[];
  usage: Usage;
  rawResponse: RawResponse;
  messageId?: string;
};

export type CompletionModelCapabilities = {
  streaming: boolean;
  tools: boolean;
  toolChoice: boolean;
  imageInput: boolean;
  documentInput: boolean;
  outputSchema: boolean;
  reasoning: boolean;
};

export interface CompletionModel<RawResponse = unknown, ModelName extends string = string> {
  readonly provider: string;
  readonly defaultModel: ModelName;
  readonly capabilities: CompletionModelCapabilities;
  traceRequest?(
    request: CompletionRequest<ModelName>,
    options?: { stream?: boolean | undefined },
  ): JsonObject | undefined;
  completion(request: CompletionRequest<ModelName>): Promise<CompletionResponse<RawResponse>>;
}

export type CompletionStreamEvent<RawResponse = unknown> =
  | {
      type: "text_delta";
      delta: string;
    }
  | {
      type: "reasoning_delta";
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | {
      type: "tool_call_delta";
      id: string;
      callId?: string;
      name?: string;
      argumentsDelta?: string;
      signature?: string;
    }
  | {
      type: "tool_call";
      toolCall: ToolCall;
    }
  | {
      type: "message_id";
      id: string;
    }
  | {
      type: "final";
      response: CompletionResponse<RawResponse>;
    }
  | {
      type: "error";
      error: unknown;
    };

export interface StreamingCompletionModel<RawResponse = unknown, ModelName extends string = string>
  extends CompletionModel<RawResponse, ModelName> {
  streamCompletion(
    request: CompletionRequest<ModelName>,
  ): AsyncIterable<CompletionStreamEvent<RawResponse>>;
}

export class CompletionCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionCapabilityError";
  }
}

export function assertCompletionRequestSupported(
  model: CompletionModel,
  request: CompletionRequest,
  options: { streaming?: boolean | undefined } = {},
): void {
  const modelLabel = `${model.provider}:${request.model ?? model.defaultModel}`;
  const capabilities = model.capabilities;

  if (options.streaming === true && !capabilities.streaming) {
    throw new CompletionCapabilityError(`${modelLabel} does not support streaming completions.`);
  }

  if (request.tools.length > 0 && !capabilities.tools) {
    throw new CompletionCapabilityError(`${modelLabel} does not support tool definitions.`);
  }

  if (request.toolChoice !== undefined && !capabilities.toolChoice) {
    throw new CompletionCapabilityError(`${modelLabel} does not support tool choice.`);
  }

  if (request.outputSchema !== undefined && !capabilities.outputSchema) {
    throw new CompletionCapabilityError(`${modelLabel} does not support output schemas.`);
  }

  if (!capabilities.imageInput && requestHasImageInput(request)) {
    throw new CompletionCapabilityError(`${modelLabel} does not support image input.`);
  }

  if (!capabilities.documentInput && requestHasFileDocumentInput(request)) {
    throw new CompletionCapabilityError(`${modelLabel} does not support document file input.`);
  }
}

export function textFromAssistantContent(content: AssistantContent[]): string {
  return content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

function requestHasImageInput(request: CompletionRequest): boolean {
  return request.chatHistory.some((message) =>
    message.role === "system" ? false : message.content.some((content) => content.type === "image"),
  );
}

function requestHasFileDocumentInput(request: CompletionRequest): boolean {
  return request.chatHistory.some((message) =>
    message.role === "user"
      ? message.content.some(
          (content) => content.type === "document" && content.source.type !== "text",
        )
      : false,
  );
}
