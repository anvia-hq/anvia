import type { Anthropic } from "@anthropic-ai/sdk";
import type { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
  assertCompletionRequestSupported,
  type CompletionModelCapabilities,
  type CompletionModelControls,
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  defineCompletionModelControls,
  type JsonObject,
  type ModelCallOptions,
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
  withContextUsage,
} from "@anvia/core/completion";
import { requireModelId } from "@anvia/core/internal/provider";
import {
  type AnthropicCreateParams,
  anthropicRequestOptions,
  anthropicRequestSummary,
  toAnthropicMessagesParams,
} from "./completion-request";
import { fromAnthropicMessage } from "./completion-response";
import { AnthropicCompletionStreamState } from "./completion-stream";
import { anthropicControlsForModel, type AnthropicControlsFor } from "./controls";
import {
  ANTHROPIC_COMPLETION_MODEL_CONTEXT_LIMITS,
  type AnthropicCompletionModelId,
} from "./models";
import {
  anthropicPromptCacheOptions,
  type AnthropicPromptCacheOptions,
  type AnthropicPromptCacheSettings,
} from "./prompt-cache";

export { anthropicMessageHelpers, toAnthropicMessagesParams } from "./completion-request";
export { fromAnthropicMessage } from "./completion-response";
export { fromAnthropicStreamEvent } from "./completion-stream";

type AnthropicMessageCreate = (
  params: AnthropicCreateParams,
  options: ReturnType<typeof anthropicRequestOptions>,
) => Promise<unknown>;

export type AnthropicCompletionModelOptions<
  ModelId extends AnthropicCompletionModelId = AnthropicCompletionModelId,
  Controls extends CompletionModelControls = AnthropicControlsFor<ModelId>,
> = {
  modelId: ModelId;
  contextLimits?: ModelContextLimits | undefined;
  controls?: Controls | undefined;
  /**
   * Adds Anthropic prompt-cache breakpoints to every request from this model.
   * `true` uses the default breakpoints and the 5-minute cache.
   */
  promptCache?: AnthropicPromptCacheSettings | undefined;
};

export type AnthropicCompletionModelHandle<
  Controls extends CompletionModelControls = CompletionModelControls,
> = StreamingCompletionModel<unknown, Controls>;

export function createAnthropicCompletionModel<
  const ModelId extends AnthropicCompletionModelId,
  const Controls extends CompletionModelControls = AnthropicControlsFor<ModelId>,
>(
  sdk: Anthropic | AnthropicVertex,
  options: AnthropicCompletionModelOptions<ModelId, Controls>,
): AnthropicCompletionModelHandle<Controls> {
  const modelId = requireModelId(options.modelId);
  const controls = (
    options.controls === undefined
      ? anthropicControlsForModel(modelId)
      : defineCompletionModelControls(options.controls)
  ) as Controls | undefined;
  return new AnthropicCompletionModel(
    sdk,
    modelId,
    resolveModelContextLimits(
      modelId,
      ANTHROPIC_COMPLETION_MODEL_CONTEXT_LIMITS,
      options.contextLimits,
    ),
    controls,
    anthropicPromptCacheOptions(options.promptCache),
  );
}

export class AnthropicCompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> implements StreamingCompletionModel<unknown, Controls> {
  readonly provider = "anthropic";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: false,
    reasoning: true,
  };

  constructor(
    private readonly client: Anthropic | AnthropicVertex,
    readonly modelId: AnthropicCompletionModelId,
    readonly contextLimits?: ModelContextLimits,
    readonly controls?: Controls,
    readonly promptCache?: AnthropicPromptCacheOptions,
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
    const params = toAnthropicMessagesParams(this.modelId, request, this.promptCache);

    if (options.stream === true) {
      params.stream = true;
    }

    return anthropicRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toAnthropicMessagesParams(this.modelId, request, this.promptCache);
    const response = await this.createMessage(params, anthropicRequestOptions(options));
    return withContextUsage(fromAnthropicMessage(response), this.modelInfo());
  }

  private createMessage(
    params: AnthropicCreateParams,
    options: ReturnType<typeof anthropicRequestOptions>,
  ): Promise<unknown> {
    const messages = this.client.messages;
    const create = messages.create as unknown as AnthropicMessageCreate;
    return create.call(messages, params, options);
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = {
      ...toAnthropicMessagesParams(this.modelId, request, this.promptCache),
      stream: true,
    };
    const stream = await this.createMessage(params, anthropicRequestOptions(options));
    const streamState = new AnthropicCompletionStreamState(this.modelInfo());
    for await (const event of stream as unknown as AsyncIterable<unknown>) {
      yield* streamState.accept(event);

      if (streamState.isTerminal) return;
    }
    streamState.assertComplete();
  }
}
