import Anthropic from "@anthropic-ai/sdk";
import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import { AnthropicCompletionModel } from "./completion";
import type { AnthropicCompletionModelName } from "./models";

export type AnthropicClientOptions = {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  client?: Anthropic | undefined;
};

export class AnthropicClient implements ModelListingClient {
  readonly client: Anthropic;

  constructor(options: AnthropicClientOptions = {}) {
    this.client =
      options.client ??
      new Anthropic({
        apiKey: requireApiKey(options.apiKey),
        baseURL: options.baseUrl,
      });
  }

  completionModel(
    model: AnthropicCompletionModelName = "claude-sonnet-4-20250514",
  ): AnthropicCompletionModel {
    return new AnthropicCompletionModel(this.client, model);
  }

  async listModels(): Promise<ModelList> {
    try {
      const response = await this.client.models.list();
      const data = (await collectModelsFromResponse(response))
        .map(toListedModel)
        .filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("Anthropic", error);
    }
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

async function collectModelsFromResponse(response: unknown): Promise<unknown[]> {
  if (isAsyncIterable(response)) {
    const models: unknown[] = [];
    for await (const model of response) {
      models.push(model);
    }
    return models;
  }

  if (Array.isArray(response)) {
    return response;
  }

  if (isObject(response) && Array.isArray(response.data)) {
    return response.data;
  }

  return [];
}

function toListedModel(model: unknown): ModelList["data"][number] | undefined {
  if (!isObject(model) || typeof model.id !== "string") {
    return undefined;
  }

  const createdAt =
    typeof model.created_at === "string"
      ? secondsFromDateString(model.created_at)
      : typeof model.created_at === "number"
        ? model.created_at
        : undefined;

  const listedModel: ModelList["data"][number] = {
    id: model.id,
  };
  if (typeof model.display_name === "string") {
    listedModel.name = model.display_name;
  }
  if (typeof model.name === "string") {
    listedModel.name = model.name;
  }
  if (typeof model.description === "string") {
    listedModel.description = model.description;
  }
  if (typeof model.type === "string") {
    listedModel.type = model.type;
  }
  if (createdAt !== undefined) {
    listedModel.createdAt = createdAt;
  }
  if (typeof model.owned_by === "string") {
    listedModel.ownedBy = model.owned_by;
  }
  if (typeof model.max_input_tokens === "number") {
    listedModel.contextLength = model.max_input_tokens;
  }
  if (typeof model.context_length === "number") {
    listedModel.contextLength = model.context_length;
  }
  return listedModel;
}

function secondsFromDateString(value: string): number | undefined {
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : Math.floor(time / 1000);
}

function isListedModel(
  model: ModelList["data"][number] | undefined,
): model is ModelList["data"][number] {
  return model !== undefined;
}

function toModelListingError(provider: string, error: unknown): ModelListingError {
  if (error instanceof ModelListingError) {
    return error;
  }

  const statusCode = getStatusCode(error);
  return new ModelListingError(`${provider} model listing failed: ${getErrorMessage(error)}`, {
    provider,
    statusCode,
    cause: error,
  });
}

function getStatusCode(error: unknown): number | undefined {
  if (!isObject(error)) {
    return undefined;
  }

  if (typeof error.status === "number") {
    return error.status;
  }

  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return isObject(value) && Symbol.asyncIterator in value;
}
