import { Mistral } from "@mistralai/mistralai";
import { MistralCompletionModel } from "./completion";
import { MistralEmbeddingModel, type MistralEmbeddingModelOptions } from "./embedding";

export type MistralClientOptions = {
  apiKey?: string | undefined;
  serverURL?: string | undefined;
  client?: Mistral | undefined;
};

export class MistralClient {
  readonly client: Mistral;

  constructor(options: MistralClientOptions = {}) {
    this.client =
      options.client ??
      new Mistral({
        apiKey: requireApiKey(options.apiKey),
        serverURL: options.serverURL,
      });
  }

  completionModel(model = "mistral-large-latest"): MistralCompletionModel {
    return new MistralCompletionModel(this.client, model);
  }

  embeddingModel(
    model = "mistral-embed",
    options: MistralEmbeddingModelOptions = {},
  ): MistralEmbeddingModel {
    return new MistralEmbeddingModel(this.client, model, options);
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Missing Mistral credentials. Pass apiKey when constructing MistralClient.");
  }

  return apiKey;
}
