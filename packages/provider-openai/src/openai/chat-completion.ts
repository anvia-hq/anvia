import {
  assertCompletionRequestSupported,
  type CompletionModelCapabilities,
  type CompletionModelControls,
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  type JsonObject,
  type ModelCallOptions,
  type ModelContextLimits,
  type StreamingCompletionModel,
  withContextUsage,
} from "@anvia/core/completion";
import { isPlainObject } from "@anvia/core/internal/provider";
import type { OpenAI } from "openai";
import {
  type ChatCompletionParams,
  chatCompletionRequestSummary,
  toOpenAIChatCompletionParams,
} from "./chat-completion-request";
import { fromOpenAIChatCompletionResponse } from "./chat-completion-response";
import { OpenAIChatCompletionStreamState } from "./chat-completion-stream";
import type { OpenAICompletionModelId } from "./models";
import { openAIRequestOptions } from "./responses-request";

export {
  openAIChatCompletionMessageHelpers,
  toOpenAIChatCompletionParams,
} from "./chat-completion-request";
export { fromOpenAIChatCompletionResponse } from "./chat-completion-response";
export { fromOpenAIChatCompletionStreamChunk } from "./chat-completion-stream";

export class OpenAIChatCompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> implements StreamingCompletionModel<unknown, Controls> {
  readonly provider = "openai";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: false,
    outputSchema: true,
    reasoning: true,
  };

  constructor(
    private readonly client: OpenAI,
    readonly modelId: OpenAICompletionModelId,
    readonly contextLimits?: ModelContextLimits,
    readonly controls?: Controls,
  ) {}

  private modelInfo(): CompletionModelInfo | undefined {
    return this.contextLimits === undefined
      ? undefined
      : { modelId: this.modelId, context: this.contextLimits };
  }

  traceRequest(
    request: CompletionRequest,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    const params: ChatCompletionParams = toOpenAIChatCompletionParams(this.modelId, request);

    if (options.stream === true) {
      params.stream = true;
      const streamOptions = isPlainObject(params.stream_options) ? params.stream_options : {};
      params.stream_options = { ...streamOptions, include_usage: true };
    }

    return chatCompletionRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toOpenAIChatCompletionParams(this.modelId, request);
    const response = await this.client.chat.completions.create(
      params as never,
      openAIRequestOptions(options),
    );
    return withContextUsage(fromOpenAIChatCompletionResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params: ChatCompletionParams = {
      ...toOpenAIChatCompletionParams(this.modelId, request),
      stream: true,
    };
    const streamOptions = isPlainObject(params.stream_options) ? params.stream_options : {};
    params.stream_options = { ...streamOptions, include_usage: true };
    const stream = await this.client.chat.completions.create(
      params as never,
      openAIRequestOptions(options),
    );
    const streamState = new OpenAIChatCompletionStreamState();
    for await (const chunk of stream as unknown as AsyncIterable<unknown>) {
      const mapping = streamState.mapChunk(chunk);
      for (const event of mapping.events) {
        if (event.type !== "final") yield event;
      }
    }
    streamState.assertComplete();
    const finalEvent = streamState.finalEvent();

    if (finalEvent !== undefined) {
      yield {
        ...finalEvent,
        response: withContextUsage(finalEvent.response, this.modelInfo()),
      };
    }
  }
}
