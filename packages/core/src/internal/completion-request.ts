import { parseMessage, parseMessages } from "../completion/message-schema";
import type {
  CompletionModel,
  CompletionRequest,
  CompletionTool,
  Document,
  JsonObject,
  Message as MessageType,
  ToolChoice,
  ToolDefinition,
} from "../completion/types";
import { isProviderTool } from "../completion/types";

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
  providerOptions?: JsonObject | undefined;
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
  if (options.providerOptions !== undefined) request.providerOptions = options.providerOptions;

  return request;
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
