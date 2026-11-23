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
import type { GoogleGenAI } from "@google/genai";
import {
  applyAbortSignal,
  geminiRequestSummary,
  toGeminiGenerateContentParams,
} from "./completion-request";
import { fromGeminiGenerateContentResponse } from "./completion-response";
import {
  GeminiCompletionStreamState,
  mapGeminiGenerateContentStreamChunk,
} from "./completion-stream";
import type { GeminiCompletionModelId } from "./models";

export { messagesToGeminiContents, toGeminiGenerateContentParams } from "./completion-request";
export { fromGeminiGenerateContentResponse } from "./completion-response";
export { fromGeminiGenerateContentStreamChunk } from "./completion-stream";

export class GeminiCompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> implements StreamingCompletionModel<unknown, Controls> {
  readonly provider = "gemini";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };

  constructor(
    private readonly client: GoogleGenAI,
    readonly modelId: GeminiCompletionModelId,
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
    const params = toGeminiGenerateContentParams(this.modelId, request);
    return geminiRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toGeminiGenerateContentParams(this.modelId, request);
    applyAbortSignal(params, options);
    const response = await this.client.models.generateContent(params as never);
    return withContextUsage(fromGeminiGenerateContentResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = toGeminiGenerateContentParams(this.modelId, request);
    applyAbortSignal(params, options);
    const stream = await this.client.models.generateContentStream(params as never);
    const streamState = new GeminiCompletionStreamState();
    for await (const chunk of stream as unknown as AsyncIterable<unknown>) {
      const mapping = mapGeminiGenerateContentStreamChunk(chunk);
      streamState.accept(chunk, mapping);
      for (const event of mapping.events) {
        if (event.type !== "final") {
          yield event;
        }
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
