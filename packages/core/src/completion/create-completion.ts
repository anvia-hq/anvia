import { createCompletionRequest } from "../internal/completion-request";
import {
  type ResolvedRetryOptions,
  type RetryOptions,
  resolveRetryOptions,
  retryDelayMs,
  retryOptionsForFailure,
  runWithRetries,
  waitForRetry,
} from "../retry";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type {
  AssistantContent,
  CompletionModel,
  CompletionRequest,
  CompletionResponse,
  CompletionStreamEvent,
  CompletionTool,
  Document,
  JsonObject,
  JsonValue,
  Message as MessageType,
  StreamingCompletionModel,
  ToolChoice,
} from "./types";
import { assertCompletionRequestSupported, textFromAssistantContent, Usage } from "./types";

export type CreateCompletionInput = string | MessageType | MessageType[];

export type CreateCompletionBaseOptions<Model extends CompletionModel = CompletionModel> = {
  model: Model;
  instructions?: string | undefined;
  documents?: Document[] | undefined;
  tools?: CompletionTool[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  toolChoice?: ToolChoice | undefined;
  outputSchema?: JsonObject | undefined;
  additionalParams?: JsonValue | undefined;
  retries?: RetryOptions | undefined;
};

export type CreateCompletionOptions<Model extends CompletionModel = CompletionModel> =
  CreateCompletionBaseOptions<Model>;

export type CreateCompletionStreamOptions<
  Model extends StreamingCompletionModel = StreamingCompletionModel,
> = CreateCompletionBaseOptions<Model>;

export type CreateParsedCompletionOptions<
  T,
  Model extends CompletionModel = CompletionModel,
> = Omit<CreateCompletionBaseOptions<Model>, "outputSchema"> & { schema: ZodSchema<T> };

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
  Model extends CompletionModel<infer RawResponse, infer _ModelName> ? RawResponse : unknown;

export async function createCompletion<Model extends CompletionModel>(
  input: CreateCompletionInput,
  options: CreateCompletionOptions<Model>,
): Promise<CreateCompletionResult<RawResponseOf<Model>>> {
  const request = createCompletionRequest(input, options);
  assertCompletionRequestSupported(options.model, request);
  const retries = resolveOptionalRetries(options.retries);
  return sendCompletion(options.model, request, retries);
}

export function createCompletionStream<Model extends StreamingCompletionModel>(
  input: CreateCompletionInput,
  options: CreateCompletionStreamOptions<Model>,
): AsyncIterable<CompletionStreamEvent<RawResponseOf<Model>>> {
  const request = createCompletionRequest(input, options);
  if (!isStreamingCompletionModel(options.model) || !options.model.capabilities.streaming) {
    throw new Error("This completion model does not support streaming");
  }
  assertCompletionRequestSupported(options.model, request, { streaming: true });
  const retries = resolveOptionalRetries(options.retries);
  return streamCompletionWithRetries(options.model, request, retries);
}

export async function createParsedCompletion<T, Model extends CompletionModel>(
  input: CreateCompletionInput,
  options: CreateParsedCompletionOptions<T, Model>,
): Promise<CreateParsedCompletionResult<T, RawResponseOf<Model>>> {
  const { schema, ...completionOptions } = options;
  const result = await createCompletion(input, {
    ...completionOptions,
    outputSchema: toProviderJsonSchema(schema),
  });
  return {
    ...result,
    data: parseCompletionData(result.text, schema),
  };
}

async function sendCompletion<Model extends CompletionModel>(
  model: Model,
  request: CompletionRequest,
  retries: ResolvedRetryOptions | undefined,
): Promise<CreateCompletionResult<RawResponseOf<Model>>> {
  const response = await runWithRetries(
    () => model.completion(request) as Promise<CompletionResponse<RawResponseOf<Model>>>,
    retries,
    { streaming: false },
  );
  return {
    text: textFromAssistantContent(response.choice),
    content: response.choice,
    usage: response.usage,
    response,
  };
}

function resolveOptionalRetries(
  options: RetryOptions | undefined,
): ResolvedRetryOptions | undefined {
  return options === undefined ? undefined : resolveRetryOptions(options);
}

async function* streamCompletionWithRetries<Model extends StreamingCompletionModel>(
  model: Model,
  request: CompletionRequest,
  retries: ResolvedRetryOptions | undefined,
): AsyncIterable<CompletionStreamEvent<RawResponseOf<Model>>> {
  let attempt = 1;
  let swallowedUsage = Usage.empty();

  while (true) {
    let exposedEvent = false;
    let retryDelay: number | undefined;
    try {
      const events = model.streamCompletion(request) as AsyncIterable<
        CompletionStreamEvent<RawResponseOf<Model>>
      >;
      for await (const event of events) {
        if (event.type === "error" && !exposedEvent) {
          const retryOptions = retryOptionsForFailure(retries, {
            error: event.error,
            attempt,
            streaming: true,
          });
          if (retryOptions !== undefined) {
            if (event.usage !== undefined) {
              swallowedUsage = Usage.add(swallowedUsage, event.usage);
            }
            retryDelay = retryDelayMs(retryOptions, attempt);
            break;
          }
        }

        exposedEvent = true;
        if (event.type === "final" && swallowedUsage.totalTokens > 0) {
          yield {
            ...event,
            response: {
              ...event.response,
              usage: Usage.add(swallowedUsage, event.response.usage),
            },
          };
        } else if (event.type === "error" && swallowedUsage.totalTokens > 0) {
          yield {
            ...event,
            usage: Usage.add(swallowedUsage, event.usage ?? Usage.empty()),
          };
        } else {
          yield event;
        }
      }
      if (retryDelay === undefined) return;
      await waitForRetry(retryDelay);
      attempt += 1;
    } catch (error) {
      if (exposedEvent) throw error;
      const retryOptions = retryOptionsForFailure(retries, {
        error,
        attempt,
        streaming: true,
      });
      if (retryOptions === undefined) throw error;
      await waitForRetry(retryDelayMs(retryOptions, attempt));
      attempt += 1;
    }
  }
}

export function isStreamingCompletionModel(
  model: CompletionModel,
): model is StreamingCompletionModel {
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
