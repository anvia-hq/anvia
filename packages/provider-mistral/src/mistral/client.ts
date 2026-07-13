import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import { Mistral } from "@mistralai/mistralai";
import { MistralCompletionModel } from "./completion";
import { MistralEmbeddingModel, type MistralEmbeddingModelOptions } from "./embedding";
import type {
  MistralCompletionModelName,
  MistralEmbeddingModelName,
  MistralOcrModelName,
} from "./models";
import { MISTRAL_OCR_LATEST, MistralOcrModel } from "./ocr";

export type MistralClientOptions = {
  apiKey?: string | undefined;
  serverURL?: string | undefined;
  client?: Mistral | undefined;
};

export class MistralClient implements ModelListingClient {
  readonly client: Mistral;

  constructor(options: MistralClientOptions = {}) {
    this.client =
      options.client ??
      new Mistral({
        apiKey: requireApiKey(options.apiKey),
        serverURL: options.serverURL,
      });
  }

  completionModel(
    model: MistralCompletionModelName = "mistral-large-latest",
  ): MistralCompletionModel {
    return new MistralCompletionModel(this.client, model);
  }

  embeddingModel(
    model: MistralEmbeddingModelName = "mistral-embed",
    options: MistralEmbeddingModelOptions = {},
  ): MistralEmbeddingModel {
    return new MistralEmbeddingModel(this.client, model, options);
  }

  ocrModel(model: MistralOcrModelName = MISTRAL_OCR_LATEST): MistralOcrModel {
    return new MistralOcrModel(this.client, model);
  }

  async listModels(): Promise<ModelList> {
    try {
      const response = await this.client.models.list();
      const data = collectModelsFromResponse(response).map(toListedModel).filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("Mistral", error);
    }
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Missing Mistral credentials. Pass apiKey when constructing MistralClient.");
  }

  return apiKey;
}

function collectModelsFromResponse(response: unknown): unknown[] {
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

  const listedModel: ModelList["data"][number] = {
    id: model.id,
  };
  if (typeof model.name === "string") {
    listedModel.name = model.name;
  }
  if (typeof model.description === "string") {
    listedModel.description = model.description;
  }
  if (typeof model.type === "string") {
    listedModel.type = model.type;
  }
  if (typeof model.created === "number") {
    listedModel.createdAt = model.created;
  }
  if (typeof model.ownedBy === "string") {
    listedModel.ownedBy = model.ownedBy;
  }
  if (typeof model.owned_by === "string") {
    listedModel.ownedBy = model.owned_by;
  }
  if (typeof model.maxContextLength === "number") {
    listedModel.contextLength = model.maxContextLength;
  }
  if (typeof model.max_context_length === "number") {
    listedModel.contextLength = model.max_context_length;
  }
  return listedModel;
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
