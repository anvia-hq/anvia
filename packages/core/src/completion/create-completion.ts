import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type {
  AssistantContent,
  CompletionModel,
  CompletionRequest,
  CompletionResponse,
  CompletionStreamEvent,
  Document,
  JsonObject,
  JsonValue,
  Message as MessageType,
  StreamingCompletionModel,
  ToolChoice,
  ToolDefinition,
  Usage,
} from "./types";
import { assertCompletionRequestSupported, Message, textFromAssistantContent } from "./types";

export type CreateCompletionInput = string | MessageType | MessageType[];

export type CreateCompletionBaseOptions = {
  input?: CreateCompletionInput | undefined;
  messages?: MessageType[] | undefined;
  instructions?: string | undefined;
  documents?: Document[] | undefined;
  tools?: ToolDefinition[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  toolChoice?: ToolChoice | undefined;
  outputSchema?: JsonObject | undefined;
  params?: JsonValue | undefined;
};

export type CreateCompletionOptions = CreateCompletionBaseOptions;

export type CreateCompletionStreamOptions = CreateCompletionBaseOptions;

export type CreateParsedCompletionOptions<T> = Omit<CreateCompletionBaseOptions, "outputSchema"> & {
  schema: ZodSchema<T>;
};

export type CreateCompletionResult<RawResponse = unknown> = {
  text: string;
  content: AssistantContent[];
  usage: Usage;
  response: CompletionResponse<RawResponse>;
};

export type CreateParsedCompletionResult<
  T,
  RawResponse = unknown,
> = CreateCompletionResult<RawResponse> & {
  data: T;
};

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

export function createCompletion<Model extends CompletionModel>(
  model: Model,
  options: CreateCompletionOptions,
): Promise<CreateCompletionResult<RawResponseOf<Model>>> {
  return sendCompletion(model, options);
}

export function createCompletionStream<Model extends StreamingCompletionModel>(
  model: Model,
  options: CreateCompletionStreamOptions,
): AsyncIterable<CompletionStreamEvent<RawResponseOf<Model>>> {
  const request = toCompletionRequest(options);
  if (!isStreamingCompletionModel(model) || !model.capabilities.streaming) {
    throw new Error("This completion model does not support streaming");
  }
  assertCompletionRequestSupported(model, request, { streaming: true });
  return model.streamCompletion(request) as AsyncIterable<
    CompletionStreamEvent<RawResponseOf<Model>>
  >;
}

export async function createParsedCompletion<T, Model extends CompletionModel>(
  model: Model,
  options: CreateParsedCompletionOptions<T>,
): Promise<CreateParsedCompletionResult<T, RawResponseOf<Model>>> {
  const { schema, ...completionOptions } = options;
  const request = toCompletionRequest(
    {
      ...completionOptions,
      outputSchema: toProviderJsonSchema(schema),
    },
    "createParsedCompletion",
  );
  assertCompletionRequestSupported(model, request);
  const response = (await model.completion(request)) as CompletionResponse<RawResponseOf<Model>>;
  const text = textFromAssistantContent(response.choice);
  return {
    data: parseCompletionData(text, schema),
    text,
    content: response.choice,
    usage: response.usage,
    response,
  };
}

async function sendCompletion<Model extends CompletionModel>(
  model: Model,
  options: CreateCompletionOptions,
): Promise<CreateCompletionResult<RawResponseOf<Model>>> {
  const request = toCompletionRequest(options);
  assertCompletionRequestSupported(model, request);
  const response = (await model.completion(request)) as CompletionResponse<RawResponseOf<Model>>;
  return {
    text: textFromAssistantContent(response.choice),
    content: response.choice,
    usage: response.usage,
    response,
  };
}

function toCompletionRequest(
  options: CreateCompletionBaseOptions,
  helperName = "createCompletion",
): CompletionRequest {
  const chatHistory = [...(options.messages ?? []), ...messagesFromInput(options.input)];

  if (chatHistory.length === 0) {
    throw new Error(`${helperName} requires input or messages.`);
  }

  const request: CompletionRequest = {
    chatHistory,
    documents: [...(options.documents ?? [])],
    tools: [...(options.tools ?? [])],
  };

  if (options.instructions !== undefined && options.instructions.length > 0) {
    request.instructions = options.instructions;
  }
  if (options.temperature !== undefined) request.temperature = options.temperature;
  if (options.maxTokens !== undefined) request.maxTokens = options.maxTokens;
  if (options.toolChoice !== undefined) request.toolChoice = options.toolChoice;
  if (options.outputSchema !== undefined) request.outputSchema = options.outputSchema;
  if (options.params !== undefined) request.additionalParams = options.params;

  return request;
}

function messagesFromInput(input: CreateCompletionInput | undefined): MessageType[] {
  if (input === undefined) {
    return [];
  }
  if (typeof input === "string") {
    return [Message.user(input)];
  }
  return Array.isArray(input) ? [...input] : [input];
}

export function isStreamingCompletionModel(model: CompletionModel): model is StreamingCompletionModel {
  return typeof (model as { streamCompletion?: unknown }).streamCompletion === "function";
}

function parseCompletionData<T>(text: string, schema: ZodSchema<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error("createParsedCompletion expected the model response to be valid JSON.", {
      cause: error,
    });
  }

  return schema.parse(json);
}
