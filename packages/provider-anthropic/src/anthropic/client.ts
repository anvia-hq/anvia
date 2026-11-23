import Anthropic from "@anthropic-ai/sdk";
import type { CompletionModelControls } from "@anvia/core/completion";
import {
  rejectManagedOptionsWithInjectedClient,
  requireApiKey,
} from "@anvia/core/internal/provider";
import type { ModelList, ModelListingClient } from "@anvia/core/model-listing";
import {
  type AnthropicCompletionModelHandle,
  type AnthropicCompletionModelOptions,
  createAnthropicCompletionModel,
} from "./completion";
import type { AnthropicControlsFor } from "./controls";
import { listAnthropicModels } from "./model-listing";
import type { AnthropicCompletionModelId } from "./models";

export type { AnthropicCompletionModelHandle, AnthropicCompletionModelOptions } from "./completion";

type AnthropicManagedClientOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  client?: never;
};

type AnthropicInjectedClientOptions = {
  client: Anthropic;
  apiKey?: never;
  baseUrl?: never;
};

export type AnthropicClientOptions = AnthropicManagedClientOptions | AnthropicInjectedClientOptions;

export class AnthropicClient implements ModelListingClient {
  private readonly sdk: Anthropic;

  constructor(options: AnthropicClientOptions) {
    if (options.client !== undefined) {
      rejectManagedOptionsWithInjectedClient("AnthropicClient", options, ["apiKey", "baseUrl"]);
      this.sdk = options.client;
      return;
    }

    this.sdk = new Anthropic({
      apiKey: requireApiKey("Anthropic", "AnthropicClient", options.apiKey),
      baseURL: options.baseUrl,
      maxRetries: 0,
    });
  }

  completionModel<
    const ModelId extends AnthropicCompletionModelId,
    const Controls extends CompletionModelControls = AnthropicControlsFor<ModelId>,
  >(
    options: AnthropicCompletionModelOptions<ModelId, Controls>,
  ): AnthropicCompletionModelHandle<Controls> {
    return createAnthropicCompletionModel(this.sdk, options);
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    return listAnthropicModels(this.sdk, options);
  }
}
