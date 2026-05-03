import Anthropic from "@anthropic-ai/sdk";
import { AnthropicCompletionModel } from "./completion";

export type AnthropicClientOptions = {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  client?: Anthropic | undefined;
};

export class AnthropicClient {
  readonly client: Anthropic;

  constructor(options: AnthropicClientOptions = {}) {
    this.client =
      options.client ??
      new Anthropic({
        apiKey: requireApiKey(options.apiKey),
        baseURL: options.baseUrl,
      });
  }

  completionModel(model = "claude-sonnet-4-20250514"): AnthropicCompletionModel {
    return new AnthropicCompletionModel(this.client, model);
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      "Missing Anthropic credentials. Pass apiKey when constructing AnthropicClient.",
    );
  }

  return apiKey;
}
