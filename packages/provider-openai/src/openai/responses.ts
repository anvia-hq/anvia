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
import type { OpenAI } from "openai";
import type { OpenAICompletionModelId } from "./models";
import {
  openAIRequestOptions,
  responsesRequestSummary,
  toOpenAIResponsesParams,
} from "./responses-request";
import { fromOpenAIResponse } from "./responses-response";
import { OpenAIResponsesStreamState } from "./responses-stream";

export { openaiMessageHelpers, toOpenAIResponsesParams } from "./responses-request";
export { fromOpenAIResponse } from "./responses-response";
export { fromOpenAIStreamEvent } from "./responses-stream";

export class OpenAIResponsesCompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> implements StreamingCompletionModel<unknown, Controls> {
  readonly provider: string = "openai";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
    providerTools: true,
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
    const params = this.requestParams(request);

    if (options.stream === true) {
      params.stream = true;
    }

    return responsesRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = this.requestParams(request);
    const response = await this.client.responses.create(
      params as never,
      openAIRequestOptions(options),
    );
    return withContextUsage(fromOpenAIResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = { ...this.requestParams(request), stream: true };
    const stream = await this.client.responses.create(
      params as never,
      openAIRequestOptions(options),
    );
    const streamState = new OpenAIResponsesStreamState();
    for await (const event of this.normalizeStream(stream as unknown as AsyncIterable<unknown>)) {
      const mapped = streamState.mapEvent(event);

      if (mapped !== undefined) {
        yield mapped.type === "final"
          ? {
              ...mapped,
              response: withContextUsage(mapped.response, this.modelInfo()),
            }
          : mapped;

        if (mapped.type === "final" || mapped.type === "error") return;
      }
    }
    streamState.assertComplete();
  }

  /** Override at the provider boundary to normalize endpoint-specific stream events. */
  protected normalizeStream(stream: AsyncIterable<unknown>): AsyncIterable<unknown> {
    return stream;
  }

  /** Override at the provider boundary to adapt requests while sharing protocol mapping. */
  protected requestParams(request: CompletionRequest): Record<string, unknown> {
    return toOpenAIResponsesParams(this.modelId, request);
  }
}
