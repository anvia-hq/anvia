import {
  AnthropicVertex,
  type ClientOptions as AnthropicVertexSdkOptions,
} from "@anthropic-ai/vertex-sdk";
import {
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import { AnthropicCompletionModel } from "./completion";
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

export type AnthropicVertexCompletionModelOptions = {
  modelId: AnthropicCompletionModelId;
  contextLimits?: ModelContextLimits | undefined;
};

export type AnthropicVertexCompletionModelHandle = StreamingCompletionModel<unknown>;

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

  completionModel(
    options: AnthropicVertexCompletionModelOptions,
  ): AnthropicVertexCompletionModelHandle {
    const modelId = requireModelId(options.modelId);
    return new AnthropicCompletionModel(
      this.sdk,
      modelId,
      resolveModelContextLimits(
        modelId,
        ANTHROPIC_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
    );
  }
}

function requireModelId<ModelId extends string>(modelId: ModelId): ModelId {
  if (modelId.trim().length === 0) {
    throw new TypeError("modelId must be a non-empty string");
  }
  return modelId;
}
