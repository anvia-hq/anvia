import { abortError, throwIfAborted } from "../internal/abort";
import { createCompletionRequest } from "../internal/completion-request";
import type { ModelCallOptions } from "../model-call-options";
import {
  completionProviderOutputErrorUsage,
  type ResolvedRetryOptions,
  type RetrySetting,
  resolveRetryOptions,
  retryDelayMs,
  retryOptionsForFailure,
  waitForRetry,
} from "../retry";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import { isJsonValue } from "./json";
import {
  assertCompletionResponseIntegrity,
  CompletionProviderOutputError,
} from "./provider-output-error";
import { CompletionStreamAccumulator } from "./stream-accumulator";
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

export type CompletionStructuredOutputPhase = "truncated" | "content-filter" | "parse" | "schema";

export class CompletionStructuredOutputError extends Error {
  readonly phase: CompletionStructuredOutputPhase;
  readonly outputLength: number;
  readonly usage: Usage;
  readonly finishReason: CompletionResponse["finishReason"];
  readonly providerFinishReason: string | undefined;

  constructor(options: {
    phase: CompletionStructuredOutputPhase;
    outputLength: number;
    usage: Usage;
    finishReason?: CompletionResponse["finishReason"];
    providerFinishReason?: string | undefined;
    cause?: unknown;
  }) {
    const failure =
      options.phase === "truncated"
        ? "because the provider reached its output limit"
        : options.phase === "content-filter"
          ? "because the provider filtered the response"
          : options.phase === "parse"
            ? "during JSON parsing"
            : "during schema validation";
    super(`Structured completion output failed ${failure}.`, { cause: options.cause });
    this.name = "CompletionStructuredOutputError";
    this.phase = options.phase;
    this.outputLength = options.outputLength;
    this.usage = options.usage;
    this.finishReason = options.finishReason;
    this.providerFinishReason = options.providerFinishReason;
  }
}

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
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

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
  let attempt = 1;
  let failedUsage = Usage.empty();
  while (true) {
    try {
      throwIfAborted(abortSignal);
      const response = (await model.completion(request, callOptions)) as CompletionResponse<
        RawResponseOf<Model>
      >;
      assertCompletionResponseIntegrity({ response });
      return Usage.isEmpty(failedUsage)
        ? response
        : { ...response, usage: Usage.add(failedUsage, response.usage) };
    } catch (error) {
      const normalizedError =
        abortSignal?.aborted === true ? abortError(abortSignal.reason) : error;
      const attemptUsage = completionProviderOutputErrorUsage(normalizedError);
      if (attemptUsage !== undefined) failedUsage = Usage.add(failedUsage, attemptUsage);
      const retryOptions = retryOptionsForFailure(retries, {
        error: normalizedError,
        attempt,
        streaming: false,
      });
      if (retryOptions === undefined) throw normalizedError;
      await waitForRetry(retryDelayMs(retryOptions, attempt), abortSignal);
      attempt += 1;
    }
  }
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

  attemptLoop: while (true) {
    let exposedProgress = false;
    let retryDelay: number | undefined;
    const accumulator = new CompletionStreamAccumulator<RawResponseOf<Model>>();
    try {
      throwIfAborted(abortSignal);
      const events = model.streamCompletion(request, callOptions) as AsyncIterable<
        CompletionModelStreamEvent<RawResponseOf<Model>>
      >;
      for await (const event of events) {
        if (event.type === "error" && !exposedProgress) {
          const eventError =
            abortSignal?.aborted === true ? abortError(abortSignal.reason) : event.error;
          const eventUsage =
            event.usage ?? completionProviderOutputErrorUsage(eventError) ?? Usage.empty();
          const retryOptions = retryOptionsForFailure(retries, {
            error: eventError,
            attempt,
            streaming: true,
          });
          if (retryOptions !== undefined) {
            swallowedUsage = Usage.add(swallowedUsage, eventUsage);
            retryDelay = retryDelayMs(retryOptions, attempt);
            break;
          }
        }

        if (event.type === "error") {
          const eventError =
            abortSignal?.aborted === true ? abortError(abortSignal.reason) : event.error;
          const eventUsage =
            event.usage ?? completionProviderOutputErrorUsage(eventError) ?? Usage.empty();
          yield {
            type: "error",
            error: eventError,
            usage: Usage.add(swallowedUsage, eventUsage),
          };
          return;
        }

        if (event.type === "final") {
          const cumulativeUsage = Usage.add(swallowedUsage, event.response.usage);
          try {
            accumulator.accept(event);
            const accumulatedResponse = accumulator.response();
            const response = Usage.isEmpty(swallowedUsage)
              ? accumulatedResponse
              : { ...accumulatedResponse, usage: cumulativeUsage };
            assertCompletionResponseIntegrity({ response });
            yield {
              type: "final",
              result: resultFromResponse(response, outputSchema),
            };
          } catch (error) {
            const retryOptions = exposedProgress
              ? undefined
              : retryOptionsForFailure(retries, {
                  error,
                  attempt,
                  streaming: true,
                });
            if (retryOptions !== undefined) {
              swallowedUsage = cumulativeUsage;
              await waitForRetry(retryDelayMs(retryOptions, attempt), abortSignal);
              attempt += 1;
              continue attemptLoop;
            }
            yield { type: "error", error, usage: cumulativeUsage };
          }
          return;
        }

        accumulator.accept(event);
        exposedProgress = true;
        yield event;
      }

      if (retryDelay !== undefined) {
        await waitForRetry(retryDelay, abortSignal);
        attempt += 1;
        continue;
      }

      let incomplete: unknown;
      try {
        accumulator.response();
        incomplete = new CompletionProviderOutputError({ kind: "incomplete-stream" });
      } catch (error) {
        incomplete = error;
      }
      if (!exposedProgress) {
        const retryOptions = retryOptionsForFailure(retries, {
          error: incomplete,
          attempt,
          streaming: true,
        });
        if (retryOptions !== undefined) {
          await waitForRetry(retryDelayMs(retryOptions, attempt), abortSignal);
          attempt += 1;
          continue;
        }
      }
      yield { type: "error", error: incomplete, usage: swallowedUsage };
      return;
    } catch (error) {
      const normalizedError =
        abortSignal?.aborted === true ? abortError(abortSignal.reason) : error;
      const attemptUsage = completionProviderOutputErrorUsage(normalizedError);
      const cumulativeUsage =
        attemptUsage === undefined ? swallowedUsage : Usage.add(swallowedUsage, attemptUsage);
      if (!exposedProgress) {
        const retryOptions = retryOptionsForFailure(retries, {
          error: normalizedError,
          attempt,
          streaming: true,
        });
        if (retryOptions !== undefined) {
          try {
            swallowedUsage = cumulativeUsage;
            await waitForRetry(retryDelayMs(retryOptions, attempt), abortSignal);
            attempt += 1;
            continue;
          } catch (waitError) {
            yield { type: "error", error: waitError, usage: cumulativeUsage };
            return;
          }
        }
      }
      yield { type: "error", error: normalizedError, usage: cumulativeUsage };
      return;
    }
  }
}

function requestFromOptions<Model extends CompletionModel, Output>(
  options: GenerateCompletionOptions<Model> | GenerateStructuredCompletionOptions<Output, Model>,
): CompletionRequest {
  const input = inputFromOptions(options);
  return createCompletionRequest(input, {
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
    output: outputSchema === undefined ? text : parseCompletionOutput(text, outputSchema, response),
    text,
    content: [...response.choice],
    usage: response.usage,
    rawResponse: response.rawResponse,
  };
  if (response.finishReason !== undefined) result.finishReason = response.finishReason;
  if (response.providerFinishReason !== undefined) {
    result.providerFinishReason = response.providerFinishReason;
  }
  if (response.contextUsage !== undefined) result.contextUsage = response.contextUsage;
  if (response.messageId !== undefined) result.messageId = response.messageId;
  if (response.sources !== undefined) result.sources = [...response.sources];
  if (response.providerToolCalls !== undefined) {
    result.providerToolCalls = [...response.providerToolCalls];
  }
  return result;
}

function parseCompletionOutput<Output, RawResponse>(
  text: string,
  schema: ZodSchema<Output>,
  response: CompletionResponse<RawResponse>,
): Output {
  if (response.finishReason === "content-filter") {
    throw new CompletionStructuredOutputError({
      phase: "content-filter",
      outputLength: text.length,
      usage: response.usage,
      finishReason: response.finishReason,
      providerFinishReason: response.providerFinishReason,
    });
  }
  if (response.finishReason === "length") {
    throw new CompletionStructuredOutputError({
      phase: "truncated",
      outputLength: text.length,
      usage: response.usage,
      finishReason: response.finishReason,
      providerFinishReason: response.providerFinishReason,
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
    if (!isJsonValue(json)) {
      throw new TypeError("Structured completion output is not a JSON value.");
    }
  } catch (error) {
    throw new CompletionStructuredOutputError({
      phase: "parse",
      outputLength: text.length,
      usage: response.usage,
      finishReason: response.finishReason,
      providerFinishReason: response.providerFinishReason,
      cause: error,
    });
  }
  try {
    return schema.parse(json);
  } catch (error) {
    throw new CompletionStructuredOutputError({
      phase: "schema",
      outputLength: text.length,
      usage: response.usage,
      finishReason: response.finishReason,
      providerFinishReason: response.providerFinishReason,
      cause: error,
    });
  }
}

function modelCallOptions(abortSignal: AbortSignal | undefined): ModelCallOptions | undefined {
  return abortSignal === undefined ? undefined : { abortSignal };
}

export function isStreamingCompletionModel(
  model: CompletionModel,
): model is StreamingCompletionModel {
  return typeof (model as { streamCompletion?: unknown }).streamCompletion === "function";
}
