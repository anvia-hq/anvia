import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import OpenAI from "openai";
import { GrokChatCompletionModel, GrokResponsesCompletionModel } from "./completion";
import { GROK_4_3, GROK_IMAGINE_IMAGE, XAI_BASE_URL } from "./constants";
import { GrokImageGenerationModel } from "./image-generation";

export type GrokClientOptions = {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  completionApi?: "responses" | "chat" | undefined;
  client?: OpenAI | undefined;
  fetch?: typeof fetch | undefined;
};

export class GrokClient implements ModelListingClient {
  readonly client: OpenAI;
  private readonly completionApi: "responses" | "chat";
  private readonly fetchFn: typeof fetch | undefined;

  constructor(options: GrokClientOptions = {}) {
    this.completionApi = options.completionApi ?? "responses";
    this.client =
      options.client ??
      new OpenAI({
        apiKey: requireApiKey(options.apiKey),
        baseURL: options.baseUrl ?? XAI_BASE_URL,
        defaultHeaders: options.headers,
      });
    this.fetchFn = options.fetch ?? defaultFetch();
  }

  completionModel(model = GROK_4_3): GrokResponsesCompletionModel | GrokChatCompletionModel {
    return this.completionApi === "chat"
      ? new GrokChatCompletionModel(this.client, model)
      : new GrokResponsesCompletionModel(this.client, model);
  }

  imageGenerationModel(model = GROK_IMAGINE_IMAGE): GrokImageGenerationModel {
    return new GrokImageGenerationModel(this.client, model, this.fetchFn);
  }

  async listModels(): Promise<ModelList> {
    try {
      const response = await this.client.models.list();
      const data = (await collectModelsFromResponse(response))
        .map(toListedModel)
        .filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("Grok", error);
    }
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Missing Grok credentials. Pass apiKey when constructing GrokClient.");
  }

  return apiKey;
}

function defaultFetch(): typeof fetch | undefined {
  return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
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

  return {
    id: model.id,
    ...(typeof model.name === "string" ? { name: model.name } : {}),
    ...(typeof model.description === "string" ? { description: model.description } : {}),
    ...(typeof model.type === "string"
      ? { type: model.type }
      : typeof model.object === "string"
        ? { type: model.object }
        : {}),
    ...(typeof model.created === "number" ? { createdAt: model.created } : {}),
    ...(typeof model.created_at === "number" ? { createdAt: model.created_at } : {}),
    ...(typeof model.owned_by === "string" ? { ownedBy: model.owned_by } : {}),
    ...(typeof model.context_length === "number" ? { contextLength: model.context_length } : {}),
    ...(typeof model.contextLength === "number" ? { contextLength: model.contextLength } : {}),
  };
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
    ...(statusCode === undefined ? {} : { statusCode }),
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
