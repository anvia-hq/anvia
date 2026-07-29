import {
  AnthropicVertex,
  type ClientOptions as AnthropicVertexSdkOptions,
} from "@anthropic-ai/vertex-sdk";
import { AnthropicCompletionModel } from "./completion";
import type { AnthropicCompletionModelName } from "./models";

export type AnthropicVertexClientOptions = AnthropicVertexSdkOptions & {
  client?: AnthropicVertex | undefined;
};

export class AnthropicVertexClient {
  readonly client: AnthropicVertex;

  constructor(options: AnthropicVertexClientOptions = {}) {
    const { client, ...clientOptions } = options;
    this.client = client ?? new AnthropicVertex(clientOptions);
  }

  completionModel(
    model: AnthropicCompletionModelName = "claude-sonnet-5",
  ): AnthropicCompletionModel {
    return new AnthropicCompletionModel(this.client, model);
  }
}
