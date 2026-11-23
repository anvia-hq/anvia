import {
  assertCompletionRequestSupported,
  type CompletionModelCapabilities,
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  type JsonObject,
  type ModelCallOptions,
  type ModelContextLimits,
  type NoCompletionModelControls,
  type StreamingCompletionModel,
  withContextUsage,
} from "@anvia/core/completion";
import type { Mistral } from "@mistralai/mistralai";
import {
  mistralRequestOptions,
  mistralRequestSummary,
  toMistralChatParams,
} from "./completion-request";
import { fromMistralChatResponse } from "./completion-response";
import { MistralCompletionStreamState } from "./completion-stream";
import type { MistralCompletionModelId } from "./models";

export { mistralMessageHelpers, toMistralChatParams } from "./completion-request";
export { fromMistralChatResponse } from "./completion-response";
export { fromMistralChatStreamChunk } from "./completion-stream";

export class MistralCompletionModel implements StreamingCompletionModel<
  unknown,
  NoCompletionModelControls
> {
  readonly provider = "mistral";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: true,
    reasoning: false,
  };

  constructor(
    private readonly client: Mistral,
    readonly modelId: MistralCompletionModelId,
    readonly contextLimits?: ModelContextLimits,
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
    const params = toMistralChatParams(this.modelId, request);
    return mistralRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toMistralChatParams(this.modelId, request);
    const response = await this.client.chat.complete(
      params as never,
      mistralRequestOptions(options) as never,
    );
    return withContextUsage(fromMistralChatResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = toMistralChatParams(this.modelId, request);
    const stream = await this.client.chat.stream(
      params as never,
      mistralRequestOptions(options) as never,
    );
    const streamState = new MistralCompletionStreamState();
    for await (const completionEvent of stream as unknown as AsyncIterable<unknown>) {
      yield* streamState.accept(completionEvent);
    }

    const finalResponse = streamState.finish();

    if (finalResponse !== undefined) {
      yield {
        type: "final",
        response: withContextUsage(finalResponse, this.modelInfo()),
      };
    }
  }
}
