import {
  AnthropicVertex,
  type ClientOptions as AnthropicVertexSdkOptions,
} from "@anthropic-ai/vertex-sdk";
import {
  type CompletionModelControls,
  defineCompletionModelControls,
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import { AnthropicCompletionModel } from "./completion";
import { anthropicControlsForModel, type AnthropicControlsFor } from "./controls";
import {
  ANTHROPIC_COMPLETION_MODEL_CONTEXT_LIMITS,
  type AnthropicCompletionModelId,
} from "./models";

type AnthropicVertexManagedClientOptions = Omit<AnthropicVertexSdkOptions, "maxRetries"> & {
  client?: never;
};

type AnthropicVertexInjectedClientOptions = {
  client: AnthropicVertex;
} & {
  [Key in Exclude<keyof AnthropicVertexManagedClientOptions, "client">]?: never;
};

export type AnthropicVertexClientOptions =
  | AnthropicVertexManagedClientOptions
  | AnthropicVertexInjectedClientOptions;

export type AnthropicVertexCompletionModelOptions<
  ModelId extends AnthropicCompletionModelId = AnthropicCompletionModelId,
  Controls extends CompletionModelControls = AnthropicControlsFor<ModelId>,
> = {
  modelId: ModelId;
  contextLimits?: ModelContextLimits | undefined;
  controls?: Controls | undefined;
};

export type AnthropicVertexCompletionModelHandle<
  Controls extends CompletionModelControls = CompletionModelControls,
> = StreamingCompletionModel<unknown, Controls>;

export class AnthropicVertexClient {
  private readonly sdk: AnthropicVertex;

  constructor(options: AnthropicVertexClientOptions) {
    const { client, ...clientOptions } = options;
    if (client !== undefined) {
      const conflict = Object.keys(clientOptions)[0];
      if (conflict !== undefined) {
        throw new TypeError(`AnthropicVertexClient cannot combine client with ${conflict}.`);
      }
      this.sdk = client;
      return;
    }
    this.sdk = new AnthropicVertex({ ...clientOptions, maxRetries: 0 });
  }

  completionModel<
    const ModelId extends AnthropicCompletionModelId,
    const Controls extends CompletionModelControls = AnthropicControlsFor<ModelId>,
  >(
    options: AnthropicVertexCompletionModelOptions<ModelId, Controls>,
  ): AnthropicVertexCompletionModelHandle<Controls> {
    const modelId = requireModelId(options.modelId);
    const controls = (
      options.controls === undefined
        ? anthropicControlsForModel(modelId)
        : defineCompletionModelControls(options.controls)
    ) as Controls | undefined;
    return new AnthropicCompletionModel(
      this.sdk,
      modelId,
      resolveModelContextLimits(
        modelId,
        ANTHROPIC_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
      controls,
    );
  }
}

function requireModelId<ModelId extends string>(modelId: ModelId): ModelId {
  if (modelId.trim().length === 0) {
    throw new TypeError("modelId must be a non-empty string");
  }
  return modelId;
}
