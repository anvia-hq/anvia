import { abortError, throwIfAborted } from "../internal/abort";
import { createCompletionRequest } from "../internal/completion-request";
import type { ModelCallOptions } from "../model-call-options";
import {
  type ResolvedRetryOptions,
  type RetrySetting,
  resolveRetryOptions,
  retryDelayMs,
  retryOptionsForFailure,
  runWithRetries,
  waitForRetry,
} from "../retry";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type {
  CompletionModel,
  CompletionModelStreamEvent,
  CompletionRequest,
  CompletionResponse,
  CompletionResult,
  CompletionStreamEvent,
  CompletionTool,
  Document,
  JsonObject,
  Message as MessageType,
  StreamingCompletionModel,
  ToolChoice,
} from "./types";
import { assertCompletionRequestSupported, textFromAssistantContent, Usage } from "./types";

export type CompletionInput =
  | { prompt: string; messages?: never }
  | { messages: readonly MessageType[]; prompt?: never };

export type CompletionBaseOptions<Model extends CompletionModel = CompletionModel> =
  CompletionInput & {
    model: Model;
    instructions?: string | undefined;
    documents?: readonly Document[] | undefined;
    tools?: readonly CompletionTool[] | undefined;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
    toolChoice?: ToolChoice | undefined;
    providerOptions?: JsonObject | undefined;
    retries?: RetrySetting | undefined;
    abortSignal?: AbortSignal | undefined;
  };

export type GenerateCompletionOptions<Model extends CompletionModel = CompletionModel> =
  CompletionBaseOptions<Model> & { outputSchema?: never };

export type GenerateStructuredCompletionOptions<
  Output,
  Model extends CompletionModel = CompletionModel,
> = CompletionBaseOptions<Model> & { outputSchema: ZodSchema<Output> };

export type StreamCompletionOptions<
  Model extends StreamingCompletionModel = StreamingCompletionModel,
> = GenerateCompletionOptions<Model>;

export type StreamStructuredCompletionOptions<
  Output,
  Model extends StreamingCompletionModel = StreamingCompletionModel,
> = GenerateStructuredCompletionOptions<Output, Model>;

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse, infer _ModelName> ? RawResponse : unknown;

export function generateCompletion<Output, Model extends CompletionModel>(
  options: GenerateStructuredCompletionOptions<Output, Model>,
): Promise<CompletionResult<Output, RawResponseOf<Model>>>;
export function generateCompletion<Model extends CompletionModel>(
  options: GenerateCompletionOptions<Model>,
): Promise<CompletionResult<string, RawResponseOf<Model>>>;
export async function generateCompletion<Output, Model extends CompletionModel>(
  options: GenerateCompletionOptions<Model> | GenerateStructuredCompletionOptions<Output, Model>,
): Promise<CompletionResult<Output | string, RawResponseOf<Model>>> {
  throwIfAborted(options.abortSignal);
  const request = requestFromOptions(options);
  assertCompletionRequestSupported(options.model, request);
  const retries = resolveOptionalRetries(options.retries);
  const response = await sendCompletion(options.model, request, retries, options.abortSignal);
  return resultFromResponse(response, structuredOutputSchema(options));
}

export function streamCompletion<Output, Model extends StreamingCompletionModel>(
  options: StreamStructuredCompletionOptions<Output, Model>,
): AsyncIterable<CompletionStreamEvent<Output, RawResponseOf<Model>>>;
export function streamCompletion<Model extends StreamingCompletionModel>(
  options: StreamCompletionOptions<Model>,
): AsyncIterable<CompletionStreamEvent<string, RawResponseOf<Model>>>;
export function streamCompletion<Output, Model extends StreamingCompletionModel>(
  options: StreamCompletionOptions<Model> | StreamStructuredCompletionOptions<Output, Model>,
): AsyncIterable<CompletionStreamEvent<Output | string, RawResponseOf<Model>>> {
  throwIfAborted(options.abortSignal);
  const request = requestFromOptions(options);
  if (!isStreamingCompletionModel(options.model) || !options.model.capabilities.streaming) {
    throw new Error("This completion model does not support streaming");
  }
  assertCompletionRequestSupported(options.model, request, { streaming: true });
  const retries = resolveOptionalRetries(options.retries);
  return streamCompletionWithRetries(
    options.model,
    request,
    retries,
    options.abortSignal,
    structuredOutputSchema(options),
  );
}

async function sendCompletion<Model extends CompletionModel>(
  model: Model,
  request: CompletionRequest,
  retries: ResolvedRetryOptions | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<CompletionResponse<RawResponseOf<Model>>> {
  const callOptions = modelCallOptions(abortSignal);
  return runWithRetries(
    () => {
      throwIfAborted(abortSignal);
      return model.completion(request, callOptions) as Promise<
        CompletionResponse<RawResponseOf<Model>>
      >;
    },
    retries,
    { streaming: false, abortSignal },
  );
}

function resolveOptionalRetries(
  setting: RetrySetting | undefined,
): ResolvedRetryOptions | undefined {
  return setting === undefined || setting === false ? undefined : resolveRetryOptions(setting);
}

async function* streamCompletionWithRetries<Output, Model extends StreamingCompletionModel>(
  model: Model,
  request: CompletionRequest,
  retries: ResolvedRetryOptions | undefined,
  abortSignal: AbortSignal | undefined,
  outputSchema: ZodSchema<Output> | undefined,
): AsyncIterable<CompletionStreamEvent<Output | string, RawResponseOf<Model>>> {
  let attempt = 1;
  let swallowedUsage = Usage.empty();
  const callOptions = modelCallOptions(abortSignal);

  while (true) {
    let exposedProgress = false;
    let retryDelay: number | undefined;
    try {
      throwIfAborted(abortSignal);
      const events = model.streamCompletion(request, callOptions) as AsyncIterable<
        CompletionModelStreamEvent<RawResponseOf<Model>>
      >;
      for await (const event of events) {
        if (event.type === "error" && !exposedProgress) {
          const retryOptions = retryOptionsForFailure(retries, {
            error: event.error,
            attempt,
            streaming: true,
          });
          if (retryOptions !== undefined) {
            swallowedUsage = Usage.add(swallowedUsage, event.usage ?? Usage.empty());
            retryDelay = retryDelayMs(retryOptions, attempt);
            break;
          }
        }

        if (event.type === "error") {
          yield {
            type: "error",
            error: event.error,
            usage: Usage.add(swallowedUsage, event.usage ?? Usage.empty()),
          };
          return;
        }

        if (event.type === "final") {
          const response =
            swallowedUsage.totalTokens === 0
              ? event.response
              : {
                  ...event.response,
                  usage: Usage.add(swallowedUsage, event.response.usage),
                };
          try {
            yield {
              type: "final",
              result: resultFromResponse(response, outputSchema),
            };
          } catch (error) {
            yield { type: "error", error, usage: response.usage };
          }
          return;
        }

        exposedProgress = true;
        yield event;
      }

      if (retryDelay !== undefined) {
        await waitForRetry(retryDelay, abortSignal);
        attempt += 1;
        continue;
      }

      yield {
        type: "error",
        error: new Error("The completion model stream ended without a final event."),
        usage: swallowedUsage,
      };
      return;
    } catch (error) {
      const normalizedError =
        abortSignal?.aborted === true ? abortError(abortSignal.reason) : error;
      if (!exposedProgress) {
        const retryOptions = retryOptionsForFailure(retries, {
          error: normalizedError,
          attempt,
          streaming: true,
        });
        if (retryOptions !== undefined) {
          try {
            await waitForRetry(retryDelayMs(retryOptions, attempt), abortSignal);
            attempt += 1;
            continue;
          } catch (waitError) {
            yield { type: "error", error: waitError, usage: swallowedUsage };
            return;
          }
        }
      }
      yield { type: "error", error: normalizedError, usage: swallowedUsage };
      return;
    }
  }
}

function requestFromOptions<Model extends CompletionModel, Output>(
  options: GenerateCompletionOptions<Model> | GenerateStructuredCompletionOptions<Output, Model>,
): CompletionRequest {
  const input = inputFromOptions(options);
  return createCompletionRequest(input, {
    model: options.model,
    instructions: options.instructions,
    documents: options.documents,
    tools: options.tools,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    toolChoice: options.toolChoice,
    providerOptions: options.providerOptions,
    outputSchema:
      "outputSchema" in options && options.outputSchema !== undefined
        ? toProviderJsonSchema(options.outputSchema)
        : undefined,
  });
}

function inputFromOptions(options: CompletionInput): string | readonly MessageType[] {
  const prompt = (options as { prompt?: unknown }).prompt;
  const messages = (options as { messages?: unknown }).messages;
  const hasPrompt = prompt !== undefined;
  const hasMessages = messages !== undefined;
  if (hasPrompt === hasMessages) {
    throw new TypeError("Exactly one of prompt or messages must be provided.");
  }
  if (hasPrompt) {
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      throw new TypeError("Completion prompt must be a non-empty string.");
    }
    return prompt;
  }
  if (!Array.isArray(messages)) {
    throw new TypeError("Completion messages must be an array of Message values.");
  }
  return messages as readonly MessageType[];
}

function structuredOutputSchema<Output>(options: {
  outputSchema?: ZodSchema<Output> | undefined;
}): ZodSchema<Output> | undefined {
  return options.outputSchema;
}

function resultFromResponse<Output, RawResponse>(
  response: CompletionResponse<RawResponse>,
  outputSchema: ZodSchema<Output> | undefined,
): CompletionResult<Output | string, RawResponse> {
  const text = textFromAssistantContent(response.choice);
  const result: CompletionResult<Output | string, RawResponse> = {
    output: outputSchema === undefined ? text : parseCompletionOutput(text, outputSchema),
    text,
    content: [...response.choice],
    usage: response.usage,
    rawResponse: response.rawResponse,
  };
  if (response.contextUsage !== undefined) result.contextUsage = response.contextUsage;
  if (response.messageId !== undefined) result.messageId = response.messageId;
  if (response.sources !== undefined) result.sources = [...response.sources];
  if (response.providerToolCalls !== undefined) {
    result.providerToolCalls = [...response.providerToolCalls];
  }
  return result;
}

function parseCompletionOutput<Output>(text: string, schema: ZodSchema<Output>): Output {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error("generateCompletion expected the model response to be valid JSON.", {
      cause: error,
    });
  }
  return schema.parse(json);
}

function modelCallOptions(abortSignal: AbortSignal | undefined): ModelCallOptions | undefined {
  return abortSignal === undefined ? undefined : { abortSignal };
}

export function isStreamingCompletionModel(
  model: CompletionModel,
): model is StreamingCompletionModel {
  return typeof (model as { streamCompletion?: unknown }).streamCompletion === "function";
}
