import { parseMessage, parseMessages } from "../completion/message-schema";
import type {
  CompletionRequest,
  CompletionTool,
  Document,
  JsonObject,
  Message as MessageType,
  ToolChoice,
  ToolDefinition,
} from "../completion/types";
import { isProviderTool } from "../completion/types";
import { assertJsonObject } from "./json-object";

export type CompletionRequestOptions = {
  instructions?: string | undefined;
  documents?: readonly Document[] | undefined;
  tools?: readonly CompletionTool[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  toolChoice?: ToolChoice | undefined;
  outputSchema?: JsonObject | undefined;
  providerOptions?: JsonObject | undefined;
};

export function createCompletionRequest(
  input: string | MessageType | readonly MessageType[],
  options: CompletionRequestOptions,
): CompletionRequest {
  const configuredTools = options.tools ?? [];
  const chatHistory = messagesFromInput(input);
  assertNoAgentInteractionParts(chatHistory);
  const request: CompletionRequest = {
    chatHistory,
    documents: [...(options.documents ?? [])],
    tools: configuredTools.filter((tool): tool is ToolDefinition => !isProviderTool(tool)),
  };
  const providerTools = configuredTools.filter(isProviderTool);

  if (providerTools.length > 0) request.providerTools = providerTools;
  if (options.instructions !== undefined && options.instructions.length > 0) {
    request.instructions = options.instructions;
  }
  if (options.temperature !== undefined) request.temperature = options.temperature;
  if (options.maxTokens !== undefined) request.maxTokens = options.maxTokens;
  if (options.toolChoice !== undefined) request.toolChoice = options.toolChoice;
  if (options.outputSchema !== undefined) request.outputSchema = options.outputSchema;
  if (options.providerOptions !== undefined) {
    assertJsonObject(options.providerOptions, "providerOptions");
    request.providerOptions = options.providerOptions;
  }

  return request;
}

function assertNoAgentInteractionParts(messages: readonly MessageType[]): void {
  for (const message of messages) {
    if (message.role === "tool" && message.content.some((part) => part.type !== "tool-result")) {
      throw new TypeError(
        "Completion messages contain an unresolved Agent interaction response. Resume the Agent with its continuation instead of sending interaction parts directly to a provider.",
      );
    }
  }
}

function messagesFromInput(input: string | MessageType | readonly MessageType[]): MessageType[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new Error("input must contain at least one Message.");
    }
    return parseMessages(input);
  }
  return [parseMessage(input)];
}
