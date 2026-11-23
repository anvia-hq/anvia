import { AgentStructuredOutputError } from "../../agent/errors";
import { isStreamingCompletionModel } from "../../completion/generate-completion";
import {
  assertCompletionRequestSupported,
  type CompletionFinishReason,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  isJsonValue,
  type JsonObject,
  textFromAssistantContent,
  Usage,
} from "../../completion/index";
import { assertCompletionResponseIntegrity } from "../../completion/provider-output-error";
import { CompletionStreamAccumulator } from "../../completion/stream-accumulator";
import type { ContextBreakdown } from "../../context/breakdown";
import { scaleContextBreakdown } from "../../context/breakdown";
import type { ModelCallOptions } from "../../model-call-options";
import type { ActiveAgentRunObservers, ActiveGenerationObservers } from "../../observability/group";
import type {
  AgentGenerationModelInfo,
  AgentGenerationStartArgs,
  AgentGenerationToolMatch,
  AgentTraceOptions,
} from "../../observability/types";
import {
  completionProviderOutputErrorUsage,
  type ResolvedRetryOptions,
  retryDelayMs,
  retryErrorAttributes,
  retryOptionsForFailure,
  waitForRetry,
} from "../../retry";
import type { ZodSchema } from "../../schema/zod-schema";
import type { AgentCompletionStream, AgentCompletionStreamEvent } from "./execution";
import {
  providerOutputRetryEventAttributes,
  settleFailureCleanup,
  structuredOutputRetryEventAttributes,
  structuredOutputRetryRequest,
} from "./run-outcomes";
import { addTurn, addTurnToToolCallDelta, isGenerationDeltaEvent } from "./stream-events";
import { normalizeStructuredOutput } from "./structured-output";

export type StreamingCompletionState = {
  response: CompletionResponse | undefined;
  firstDeltaMs: number | undefined;
  emittedToolCallIds: Set<string>;
  providerErrorUsage: Usage;
  attemptInputTokens: number | undefined;
};

export type CompletionRunnerContext<Output> = {
  model: CompletionModel;
  outputSchema: ZodSchema<Output> | undefined;
  retryOptions: ResolvedRetryOptions | undefined;
  abortSignal: AbortSignal;
  throwIfCancelled: () => void;
  getTurnContext: (turn: number) => ContextBreakdown | undefined;
  setValidatedStructuredOutput: (validated: { text: string; output: Output } | undefined) => void;
  getValidatedStructuredOutput: () => { text: string; output: Output } | undefined;
  recordFailedAttemptUsage: (usage: Usage) => void;
};

export function providerTraceRequest(
  model: CompletionModel,
  request: CompletionRequest,
  options: { stream?: boolean | undefined } = {},
): JsonObject | undefined {
  try {
    return model.traceRequest?.(request, options);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildGenerationStartArgs(args: {
  model: CompletionModel;
  turn: number;
  request: CompletionRequest;
  promptRef: AgentTraceOptions["promptRef"];
  providerRequest: JsonObject | undefined;
  toolMatches?: readonly AgentGenerationToolMatch[] | undefined;
  context?: ContextBreakdown | undefined;
}): AgentGenerationStartArgs & { modelInfo: AgentGenerationModelInfo } {
  let startArgs: AgentGenerationStartArgs & { modelInfo: AgentGenerationModelInfo } = {
    turn: args.turn,
    request: args.request,
    promptRef: args.promptRef,
    modelInfo: {
      provider: args.model.provider,
      modelId: args.model.modelId,
      capabilities: args.model.capabilities,
    },
  };

  if (args.providerRequest !== undefined) {
    startArgs = { ...startArgs, providerRequest: args.providerRequest };
  }

  if (args.toolMatches !== undefined && args.toolMatches.length > 0) {
    startArgs = { ...startArgs, toolMatches: args.toolMatches };
  }

  if (args.context !== undefined) {
    startArgs = { ...startArgs, context: args.context };
  }

  return startArgs;
}

export function reportedGenerationContext(
  context: ContextBreakdown | undefined,
  inputTokens: number,
): { context?: ContextBreakdown } {
  return context === undefined ? {} : { context: scaleContextBreakdown(context, inputTokens) };
}

export function estimatedGenerationContext(context: ContextBreakdown | undefined): {
  context?: ContextBreakdown;
} {
  return context === undefined ? {} : { context };
}

export function parseStructuredOutput<Output>(
  context: CompletionRunnerContext<Output>,
  text: string,
  attempt = 1,
  usage = Usage.empty(),
  options: {
    useValidatedOutput?: boolean;
    attemptUsage?: Usage;
    finishReason?: CompletionFinishReason | undefined;
    providerFinishReason?: string | undefined;
  } = {},
): Output {
  const schema = context.outputSchema;

  if (schema === undefined) return text as Output;

  const cached = context.getValidatedStructuredOutput();

  if (options.useValidatedOutput !== false && cached?.text === text) {
    return cached.output;
  }

  const normalized = normalizeStructuredOutput(text);
  const maxAttempts = context.retryOptions?.maxAttempts ?? 1;
  let json: unknown;
  try {
    json = JSON.parse(normalized.text);

    if (!isJsonValue(json)) {
      throw new TypeError("Agent structured output is not a JSON value.");
    }
  } catch (error) {
    throw new AgentStructuredOutputError({
      phase: "parse",
      attempt,
      maxAttempts,
      outputLength: text.length,
      normalizedLength: normalized.text.length,
      outputFormat: normalized.format,
      attemptUsage: options.attemptUsage ?? usage,
      usage,
      finishReason: options.finishReason,
      providerFinishReason: options.providerFinishReason,
      cause: error,
    });
  }
  try {
    return schema.parse(json);
  } catch (error) {
    throw new AgentStructuredOutputError({
      phase: "schema",
      attempt,
      maxAttempts,
      outputLength: text.length,
      normalizedLength: normalized.text.length,
      outputFormat: normalized.format,
      attemptUsage: options.attemptUsage ?? usage,
      usage,
      finishReason: options.finishReason,
      providerFinishReason: options.providerFinishReason,
      cause: error,
    });
  }
}

function validateStructuredResponse<Output>(
  context: CompletionRunnerContext<Output>,
  response: CompletionResponse,
  attempt: number,
  usage: Usage,
): void {
  if (context.outputSchema === undefined) return;

  if (response.choice.some((item) => item.type === "tool-call")) return;

  const text = textFromAssistantContent(response.choice);
  const normalized = normalizeStructuredOutput(text);

  if (response.finishReason === "content-filter") {
    throw new AgentStructuredOutputError({
      phase: "content-filter",
      attempt,
      maxAttempts: context.retryOptions?.maxAttempts ?? 1,
      outputLength: text.length,
      normalizedLength: normalized.text.length,
      outputFormat: normalized.format,
      attemptUsage: response.usage,
      usage,
      finishReason: response.finishReason,
      providerFinishReason: response.providerFinishReason,
    });
  }

  if (response.finishReason === "length") {
    throw new AgentStructuredOutputError({
      phase: "truncated",
      attempt,
      maxAttempts: context.retryOptions?.maxAttempts ?? 1,
      outputLength: text.length,
      normalizedLength: normalized.text.length,
      outputFormat: normalized.format,
      attemptUsage: response.usage,
      usage,
      finishReason: response.finishReason,
      providerFinishReason: response.providerFinishReason,
    });
  }

  const output = parseStructuredOutput(context, text, attempt, usage, {
    useValidatedOutput: false,
    attemptUsage: response.usage,
    finishReason: response.finishReason,
    providerFinishReason: response.providerFinishReason,
  });
  context.setValidatedStructuredOutput({ text, output });
}

function selectRetryOptions(
  retryOptions: ResolvedRetryOptions | undefined,
  abortSignal: AbortSignal,
  error: unknown,
  attempt: number,
  turn: number,
  streaming: boolean,
): ResolvedRetryOptions | undefined {
  if (abortSignal.aborted) return undefined;

  return retryOptionsForFailure(retryOptions, {
    error,
    attempt,
    turn,
    streaming,
  });
}

async function scheduleCompletionRetry(args: {
  error: unknown;
  attempt: number;
  turn: number;
  streaming: boolean;
  options: ResolvedRetryOptions;
  runObservers: ActiveAgentRunObservers;
  abortSignal: AbortSignal;
  additionalAttributes?: JsonObject | undefined;
}): Promise<void> {
  const delayMs = retryDelayMs(args.options, args.attempt);
  const attributes: JsonObject = {
    turn: args.turn,
    attempt: args.attempt,
    nextAttempt: args.attempt + 1,
    maxAttempts: args.options.maxAttempts,
    delayMs,
    streaming: args.streaming,
    ...retryErrorAttributes(args.error),
  };

  if (args.additionalAttributes !== undefined) {
    Object.assign(attributes, args.additionalAttributes);
  }

  await args.runObservers.event({
    name: "completion.retry",
    level: "WARNING",
    attributes,
  });
  await waitForRetry(delayMs, args.abortSignal);
}

export async function runUncachedCompletion<Output>(
  context: CompletionRunnerContext<Output>,
  args: {
    request: CompletionRequest;
    turn: number;
    runObservers: ActiveAgentRunObservers;
    promptRef: AgentTraceOptions["promptRef"];
    toolMatches?: readonly AgentGenerationToolMatch[] | undefined;
  },
): Promise<CompletionResponse> {
  assertCompletionRequestSupported(context.model, args.request);
  context.setValidatedStructuredOutput(undefined);
  context.recordFailedAttemptUsage(Usage.empty());
  const providerRequest = providerTraceRequest(context.model, args.request);
  const generationObservers = await args.runObservers.startGeneration(
    buildGenerationStartArgs({
      model: context.model,
      turn: args.turn,
      request: args.request,
      promptRef: args.promptRef,
      providerRequest,
      toolMatches: args.toolMatches,
      context: context.getTurnContext(args.turn),
    }),
  );
  const callOptions: ModelCallOptions = { abortSignal: context.abortSignal };
  let currentRequest = args.request;
  let failedAttemptUsage = Usage.empty();
  try {
    for (let attempt = 1; ; attempt += 1) {
      let response: CompletionResponse;
      try {
        context.throwIfCancelled();
        response = await context.model.completion(currentRequest, callOptions);
        assertCompletionResponseIntegrity({ response });
      } catch (error) {
        const attemptUsage = completionProviderOutputErrorUsage(error);

        if (attemptUsage !== undefined) {
          failedAttemptUsage = Usage.add(failedAttemptUsage, attemptUsage);
          context.recordFailedAttemptUsage(failedAttemptUsage);
        }

        const retryOptions = selectRetryOptions(
          context.retryOptions,
          context.abortSignal,
          error,
          attempt,
          args.turn,
          false,
        );

        if (retryOptions === undefined) {
          throw error;
        }

        await scheduleCompletionRetry({
          error,
          attempt,
          turn: args.turn,
          streaming: false,
          options: retryOptions,
          runObservers: args.runObservers,
          abortSignal: context.abortSignal,
          additionalAttributes: providerOutputRetryEventAttributes(error, failedAttemptUsage),
        });
        continue;
      }

      const cumulativeUsage = Usage.add(failedAttemptUsage, response.usage);
      try {
        validateStructuredResponse(context, response, attempt, cumulativeUsage);
      } catch (error) {
        const retryOptions = selectRetryOptions(
          context.retryOptions,
          context.abortSignal,
          error,
          attempt,
          args.turn,
          false,
        );

        if (retryOptions === undefined) {
          throw error;
        }

        failedAttemptUsage = cumulativeUsage;
        context.recordFailedAttemptUsage(failedAttemptUsage);
        const retryRequest = structuredOutputRetryRequest(args.request, response, error);
        currentRequest = retryRequest.request;
        await scheduleCompletionRetry({
          error,
          attempt,
          turn: args.turn,
          streaming: false,
          options: retryOptions,
          runObservers: args.runObservers,
          abortSignal: context.abortSignal,
          additionalAttributes: structuredOutputRetryEventAttributes(error, retryRequest),
        });
        continue;
      }

      const finalResponse = Usage.isEmpty(failedAttemptUsage)
        ? response
        : { ...response, usage: cumulativeUsage };
      await generationObservers.end({
        turn: args.turn,
        response: finalResponse,
        ...reportedGenerationContext(context.getTurnContext(args.turn), response.usage.inputTokens),
      });
      context.recordFailedAttemptUsage(Usage.empty());
      return finalResponse;
    }
  } catch (error) {
    await settleFailureCleanup([
      () =>
        generationObservers.error({
          turn: args.turn,
          error,
          ...estimatedGenerationContext(context.getTurnContext(args.turn)),
        }),
    ]);
    throw error;
  }
}

export async function* runUncachedStreamingCompletion<Output>(
  context: CompletionRunnerContext<Output>,
  args: {
    request: CompletionRequest;
    turn: number;
    bufferResponseEvents: boolean;
    bufferOutputDeltas: boolean;
    generationStartedAt: number;
    generationObservers: ActiveGenerationObservers;
    runObservers: ActiveAgentRunObservers;
    state: StreamingCompletionState;
  },
): AgentCompletionStream {
  const model = context.model;

  if (!isStreamingCompletionModel(model)) {
    throw new TypeError("Streaming completion requires a streaming-capable model.");
  }

  context.setValidatedStructuredOutput(undefined);
  const callOptions: ModelCallOptions = { abortSignal: context.abortSignal };
  let currentRequest = args.request;
  for (let attempt = 1; ; attempt += 1) {
    const accumulator = new CompletionStreamAccumulator();
    let hasProviderProgress = false;
    let recordedErrorUsage = false;
    let attemptErrorUsage: Usage | undefined;
    try {
      context.throwIfCancelled();
      for await (const event of model.streamCompletion(currentRequest, callOptions)) {
        if (event.type === "error") {
          const eventUsage = event.usage ?? completionProviderOutputErrorUsage(event.error);

          if (eventUsage !== undefined) {
            args.state.providerErrorUsage = Usage.add(args.state.providerErrorUsage, eventUsage);
            recordedErrorUsage = true;
            attemptErrorUsage = eventUsage;
          }

          throw event.error;
        }

        const mapped = accumulator.accept(event);

        if (event.type === "final") break;

        if (event.type === "tool_call_delta" || mapped !== undefined) {
          hasProviderProgress = true;
        }

        if (args.state.firstDeltaMs === undefined && isGenerationDeltaEvent(event.type)) {
          args.state.firstDeltaMs = Date.now() - args.generationStartedAt;
        }

        if (event.type === "tool_call_delta") {
          yield addTurnToToolCallDelta(args.turn, event);
        }

        if (mapped !== undefined) {
          await args.generationObservers.update?.({ turn: args.turn, delta: mapped });

          if (mapped.type === "tool_call") {
            args.state.emittedToolCallIds.add(mapped.toolCall.toolCallId);
          }

          const shouldBuffer =
            args.bufferResponseEvents ||
            (args.bufferOutputDeltas &&
              (mapped.type === "text_delta" || mapped.type === "reasoning_delta"));

          if (!shouldBuffer) {
            yield addTurn(args.turn, mapped) as AgentCompletionStreamEvent;
          }
        }
      }
      const response = accumulator.response();
      assertCompletionResponseIntegrity({ response });
      args.state.attemptInputTokens = response.usage.inputTokens;
      const cumulativeStructuredUsage = Usage.add(args.state.providerErrorUsage, response.usage);
      try {
        validateStructuredResponse(context, response, attempt, cumulativeStructuredUsage);
      } catch (error) {
        const retryOptions = selectRetryOptions(
          context.retryOptions,
          context.abortSignal,
          error,
          attempt,
          args.turn,
          true,
        );

        if (retryOptions === undefined) {
          if (error instanceof AgentStructuredOutputError) {
            args.state.providerErrorUsage = Usage.empty();
          }

          throw error;
        }

        args.state.providerErrorUsage = Usage.add(args.state.providerErrorUsage, response.usage);
        args.state.firstDeltaMs = undefined;
        args.state.emittedToolCallIds.clear();
        const retryRequest = structuredOutputRetryRequest(args.request, response, error);
        currentRequest = retryRequest.request;
        await scheduleCompletionRetry({
          error,
          attempt,
          turn: args.turn,
          streaming: true,
          options: retryOptions,
          runObservers: args.runObservers,
          abortSignal: context.abortSignal,
          additionalAttributes: structuredOutputRetryEventAttributes(error, retryRequest),
        });
        continue;
      }
      args.state.response = Usage.isEmpty(args.state.providerErrorUsage)
        ? response
        : { ...response, usage: cumulativeStructuredUsage };
      args.state.providerErrorUsage = Usage.empty();
      return args.state.response;
    } catch (error) {
      if (!recordedErrorUsage) {
        const attemptUsage = completionProviderOutputErrorUsage(error);

        if (attemptUsage !== undefined) {
          args.state.providerErrorUsage = Usage.add(args.state.providerErrorUsage, attemptUsage);
          attemptErrorUsage = attemptUsage;
        }
      }

      const retryOptions = hasProviderProgress
        ? undefined
        : selectRetryOptions(
            context.retryOptions,
            context.abortSignal,
            error,
            attempt,
            args.turn,
            true,
          );

      if (retryOptions === undefined) {
        throw error;
      }

      await scheduleCompletionRetry({
        error,
        attempt,
        turn: args.turn,
        streaming: true,
        options: retryOptions,
        runObservers: args.runObservers,
        abortSignal: context.abortSignal,
        additionalAttributes: providerOutputRetryEventAttributes(
          error,
          args.state.providerErrorUsage,
          attemptErrorUsage,
        ),
      });
    }
  }
}
