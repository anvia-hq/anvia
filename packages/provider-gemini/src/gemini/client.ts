import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import { GoogleGenAI } from "@google/genai";
import { GeminiCompletionModel } from "./completion";
import { GeminiEmbeddingModel, type GeminiEmbeddingModelOptions } from "./embedding";
import {
  GEMINI_2_5_FLASH_IMAGE,
  GeminiImageGenerationModel,
  GeminiImagenGenerationModel,
  IMAGEN_4_GENERATE,
} from "./image-generation";
import type {
  GeminiCompletionModelName,
  GeminiEmbeddingModelName,
  GeminiImageGenerationModelName,
  GeminiTranscriptionModelName,
} from "./models";
import { GeminiTranscriptionModel } from "./transcription";

type GeminiApiClientOptions = {
  apiKey?: string | undefined;
  vertexai?: false | undefined;
  project?: never;
  location?: never;
};

type VertexClientOptions = {
  vertexai: true;
  project?: string | undefined;
  location?: string | undefined;
  apiKey?: never;
};

export type GeminiClientOptions = (GeminiApiClientOptions | VertexClientOptions) & {
  client?: GoogleGenAI | undefined;
};

export class GeminiClient implements ModelListingClient {
  readonly client: GoogleGenAI;

  constructor(options: GeminiClientOptions = {}) {
    this.client = options.client ?? new GoogleGenAI(toGoogleGenAIOptions(options));
  }

  completionModel(model: GeminiCompletionModelName = "gemini-2.5-flash"): GeminiCompletionModel {
    return new GeminiCompletionModel(this.client, model);
  }

  embeddingModel(
    model: GeminiEmbeddingModelName = "gemini-embedding-001",
    options: GeminiEmbeddingModelOptions = {},
  ): GeminiEmbeddingModel {
    return new GeminiEmbeddingModel(this.client, model, options);
  }

  imageGenerationModel(
    model: GeminiImageGenerationModelName = GEMINI_2_5_FLASH_IMAGE,
  ): GeminiImageGenerationModel {
    return new GeminiImageGenerationModel(this.client, model);
  }

  imagenGenerationModel(
    model: GeminiImageGenerationModelName = IMAGEN_4_GENERATE,
  ): GeminiImagenGenerationModel {
    return new GeminiImagenGenerationModel(this.client, model);
  }

  transcriptionModel(
    model: GeminiTranscriptionModelName = "gemini-2.5-flash",
  ): GeminiTranscriptionModel {
    return new GeminiTranscriptionModel(this.client, model);
  }

  async listModels(): Promise<ModelList> {
    try {
      const response = await this.client.models.list({ config: { pageSize: 1000 } });
      const data = (await collectModelsFromResponse(response))
        .map(toListedModel)
        .filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("Gemini", error);
    }
  }
}

export function toGoogleGenAIOptions(options: GeminiClientOptions): Record<string, unknown> {
  if (options.vertexai === true) {
    return {
      vertexai: true,
      project: requireOption(options.project, "project", "Vertex Gemini"),
      location: requireOption(options.location, "location", "Vertex Gemini"),
    };
  }

  return {
    apiKey: requireOption(options.apiKey, "apiKey", "Gemini"),
  };
}

function requireOption(value: string | undefined, name: string, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${label} ${name}. Pass ${name} when constructing GeminiClient.`);
  }

  return value;
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

  if (isObject(response) && Array.isArray(response.models)) {
    return response.models;
  }

  if (isObject(response) && Array.isArray(response.data)) {
    return response.data;
  }

  return [];
}

function toListedModel(model: unknown): ModelList["data"][number] | undefined {
  if (!isObject(model)) {
    return undefined;
  }

  const id =
    stringValue(model.baseModelId) ??
    stringValue(model.base_model_id) ??
    normalizeGeminiModelId(stringValue(model.name));

  if (id === undefined) {
    return undefined;
  }

  return {
    id,
    ...(typeof model.displayName === "string" ? { name: model.displayName } : {}),
    ...(typeof model.display_name === "string" ? { name: model.display_name } : {}),
    ...(typeof model.description === "string" ? { description: model.description } : {}),
    ...(typeof model.type === "string" ? { type: model.type } : {}),
    ...(typeof model.inputTokenLimit === "number" ? { contextLength: model.inputTokenLimit } : {}),
    ...(typeof model.input_token_limit === "number"
      ? { contextLength: model.input_token_limit }
      : {}),
  };
}

function normalizeGeminiModelId(name: string | undefined): string | undefined {
  const trimmed = name?.trim().replace(/^models\//, "");
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
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
