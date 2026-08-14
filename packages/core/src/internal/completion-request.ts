import type {
  CompletionModel,
  CompletionRequest,
  CompletionTool,
  Document,
  JsonObject,
  JsonValue,
  Message as MessageType,
  ToolChoice,
  ToolDefinition,
} from "../completion/types";
import { isProviderTool, Message } from "../completion/types";

type ModelNameOf<Model extends CompletionModel> =
  Model extends CompletionModel<unknown, infer ModelName> ? ModelName : string;

export type CompletionRequestFor<Model extends CompletionModel> = CompletionRequest<
  ModelNameOf<Model>
>;

export type CompletionRequestOptions<Model extends CompletionModel = CompletionModel> = {
  model: Model;
  modelOverride?: ModelNameOf<Model> | undefined;
  instructions?: string | undefined;
  documents?: readonly Document[] | undefined;
  tools?: readonly CompletionTool[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  toolChoice?: ToolChoice | undefined;
  outputSchema?: JsonObject | undefined;
  additionalParams?: JsonValue | undefined;
};

export function createCompletionRequest<Model extends CompletionModel>(
  input: string | MessageType | readonly MessageType[],
  options: CompletionRequestOptions<Model>,
): CompletionRequestFor<Model> {
  const configuredTools = options.tools ?? [];
  const request: CompletionRequestFor<Model> = {
    chatHistory: messagesFromInput(input),
    documents: [...(options.documents ?? [])],
    tools: configuredTools.filter((tool): tool is ToolDefinition => !isProviderTool(tool)),
  };
  const providerTools = configuredTools.filter(isProviderTool);

  if (providerTools.length > 0) request.providerTools = providerTools;
  if (options.modelOverride !== undefined) request.model = options.modelOverride;
  if (options.instructions !== undefined && options.instructions.length > 0) {
    request.instructions = options.instructions;
  }
  if (options.temperature !== undefined) request.temperature = options.temperature;
  if (options.maxTokens !== undefined) request.maxTokens = options.maxTokens;
  if (options.toolChoice !== undefined) request.toolChoice = options.toolChoice;
  if (options.outputSchema !== undefined) request.outputSchema = options.outputSchema;
  if (options.additionalParams !== undefined) request.additionalParams = options.additionalParams;

  return request;
}

function messagesFromInput(input: string | MessageType | readonly MessageType[]): MessageType[] {
  if (typeof input === "string") {
    return [Message.user(input)];
  }
  if (Array.isArray(input)) {
    return normalizeMessageArray(input);
  }
  if (!isCoreMessage(input)) {
    throw new TypeError("input must be a string, Message, or Message[].");
  }
  return [input];
}

function normalizeMessageArray(messages: readonly MessageType[]): MessageType[] {
  if (messages.length === 0) {
    throw new Error("input must contain at least one Message.");
  }
  if (!messages.every(isCoreMessage)) {
    throw new TypeError("input must contain only Message values.");
  }

  return [...messages];
}

function isCoreMessage(value: unknown): value is MessageType {
  if (!isRecord(value)) {
    return false;
  }

  if (value.role === "system") {
    return typeof value.content === "string";
  }

  if (value.role === "user") {
    return Array.isArray(value.content) && value.content.every(isUserContent);
  }

  if (value.role === "assistant") {
    return (
      (value.id === undefined || typeof value.id === "string") &&
      Array.isArray(value.content) &&
      value.content.every(isAssistantContent)
    );
  }

  if (value.role === "tool") {
    return Array.isArray(value.content) && value.content.every(isToolContent);
  }

  return false;
}

function isUserContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "image") {
    return isImageContent(value);
  }

  if (value.type === "document") {
    return isDocumentContent(value);
  }

  return false;
}

function isAssistantContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "reasoning") {
    return (
      typeof value.text === "string" &&
      (value.id === undefined || typeof value.id === "string") &&
      (value.content === undefined || Array.isArray(value.content))
    );
  }

  if (value.type === "tool_call") {
    return (
      typeof value.id === "string" &&
      (value.callId === undefined || typeof value.callId === "string") &&
      isRecord(value.function) &&
      typeof value.function.name === "string" &&
      "arguments" in value.function
    );
  }

  if (value.type === "image") {
    return isImageContent(value);
  }

  return false;
}

function isToolContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "tool_result" &&
    typeof value.id === "string" &&
    (value.callId === undefined || typeof value.callId === "string") &&
    (value.toolName === undefined || typeof value.toolName === "string") &&
    Array.isArray(value.content) &&
    value.content.every(isToolResultContent)
  );
}

function isToolResultContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "image") {
    return (
      typeof value.data === "string" &&
      (value.mediaType === undefined || typeof value.mediaType === "string")
    );
  }

  return false;
}

function isImageContent(value: Record<string, unknown>): boolean {
  if (!isRecord(value.source)) {
    return false;
  }

  if (value.source.type === "url") {
    return typeof value.source.url === "string";
  }

  if (value.source.type === "base64") {
    return typeof value.source.data === "string" && typeof value.source.mediaType === "string";
  }

  return false;
}

function isDocumentContent(value: Record<string, unknown>): boolean {
  if (!isRecord(value.source)) {
    return false;
  }

  if (value.source.type === "url") {
    return typeof value.source.url === "string" && typeof value.source.mediaType === "string";
  }

  if (value.source.type === "base64") {
    return typeof value.source.data === "string" && typeof value.source.mediaType === "string";
  }

  if (value.source.type === "text") {
    return (
      typeof value.source.text === "string" &&
      (value.source.mediaType === undefined || typeof value.source.mediaType === "string")
    );
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
