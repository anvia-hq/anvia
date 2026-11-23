import {
  AnthropicVertex,
  type ClientOptions as AnthropicVertexSdkOptions,
} from "@anthropic-ai/vertex-sdk";
import type { CompletionModelControls } from "@anvia/core/completion";
import {
  type AnthropicCompletionModelHandle,
  type AnthropicCompletionModelOptions,
  createAnthropicCompletionModel,
} from "./completion";
import type { AnthropicControlsFor } from "./controls";
import type { AnthropicCompletionModelId } from "./models";

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
> = AnthropicCompletionModelOptions<ModelId, Controls>;

export type AnthropicVertexCompletionModelHandle<
  Controls extends CompletionModelControls = CompletionModelControls,
> = AnthropicCompletionModelHandle<Controls>;

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
    return createAnthropicCompletionModel(this.sdk, options);
  }
}
