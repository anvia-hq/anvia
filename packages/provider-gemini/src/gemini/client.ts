import {
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import type { ImageGenerationModel } from "@anvia/core/image-generation";
import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import type { TranscriptionModel } from "@anvia/core/transcription";
import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import { GeminiCompletionModel } from "./completion";
import { GeminiEmbeddingModel, type GeminiEmbeddingModelOptions } from "./embedding";
import { GeminiImageGenerationModel, GeminiImagenGenerationModel } from "./image-generation";
import type {
  GeminiCompletionModelId,
  GeminiGenerateContentImageModelId,
  GeminiGenerateImagesModelId,
  GeminiTranscriptionModelId,
} from "./models";
import { GEMINI_COMPLETION_MODEL_CONTEXT_LIMITS } from "./models";
import { disableGeminiNativeRetries } from "./retry";
import { GeminiTranscriptionModel } from "./transcription";

type GeminiApiClientOptions = {
  apiKey: string;
  vertexAi?: never;
  client?: never;
};

type VertexClientOptions = {
  vertexAi: {
    projectId: string;
    location: string;
    googleAuthOptions?: GoogleGenAIOptions["googleAuthOptions"];
  };
  apiKey?: never;
  client?: never;
};

type InjectedClientOptions = {
  client: GoogleGenAI;
  apiKey?: never;
  vertexAi?: never;
};

export type GeminiClientOptions =
  | GeminiApiClientOptions
  | VertexClientOptions
  | InjectedClientOptions;

export type GeminiCompletionModelOptions = {
  modelId: GeminiCompletionModelId;
  contextLimits?: ModelContextLimits | undefined;
};

export type GeminiImageGenerationModelOptions =
  | { api: "generateContent"; modelId: GeminiGenerateContentImageModelId }
  | { api: "generateImages"; modelId: GeminiGenerateImagesModelId };

export type GeminiTranscriptionModelOptions = { modelId: GeminiTranscriptionModelId };

export type GeminiCompletionModelHandle = StreamingCompletionModel<unknown>;
export type GeminiEmbeddingModelHandle = EmbeddingModel;
export type GeminiImageGenerationModelHandle = ImageGenerationModel<unknown>;
export type GeminiTranscriptionModelHandle = TranscriptionModel<unknown>;

export class GeminiClient implements ModelListingClient {
  private readonly sdk: GoogleGenAI;

  constructor(options: GeminiClientOptions) {
    if (options.client !== undefined) {
      rejectManagedOptionsWithInjectedClient(options, ["apiKey", "vertexAi"]);
      this.sdk = options.client;
      return;
    }
    this.sdk = new GoogleGenAI(toGoogleGenAIOptions(options));
  }

  completionModel(options: GeminiCompletionModelOptions): GeminiCompletionModelHandle {
    const modelId = requireModelId(options.modelId);
    return new GeminiCompletionModel(
      this.sdk,
      modelId,
      resolveModelContextLimits(
        modelId,
        GEMINI_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
    );
  }

  embeddingModel(options: GeminiEmbeddingModelOptions): GeminiEmbeddingModelHandle {
    requireModelId(options.modelId);
    validateOptionalPositiveSafeInteger(options.dimensions, "dimensions");
    validateOptionalPositiveSafeInteger(options.maxBatchSize, "maxBatchSize");
    return new GeminiEmbeddingModel(this.sdk, options);
  }

  imageGenerationModel(
    options: GeminiImageGenerationModelOptions,
  ): GeminiImageGenerationModelHandle {
    const modelId = requireModelId(options.modelId);
    return options.api === "generateContent"
      ? new GeminiImageGenerationModel(this.sdk, modelId)
      : new GeminiImagenGenerationModel(this.sdk, modelId);
  }

  transcriptionModel(options: GeminiTranscriptionModelOptions): GeminiTranscriptionModelHandle {
    return new GeminiTranscriptionModel(this.sdk, requireModelId(options.modelId));
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    try {
      const response = await this.sdk.models.list({
        config: disableGeminiNativeRetries({
          pageSize: 1000,
          ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
        }),
      });
      const data = (await collectModelsFromResponse(response))
        .map(toListedModel)
        .filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("Gemini", error);
    }
  }
}

function rejectManagedOptionsWithInjectedClient(options: object, keys: readonly string[]): void {
  const conflict = keys.find((key) => key in options);
  if (conflict !== undefined) {
    throw new TypeError(`GeminiClient cannot combine client with ${conflict}.`);
  }
}

export function toGoogleGenAIOptions(options: GeminiClientOptions): GoogleGenAIOptions {
  if ("client" in options && options.client !== undefined) {
    throw new TypeError("Injected Gemini clients do not have managed SDK options.");
  }
  if ("vertexAi" in options && options.vertexAi !== undefined) {
    return {
      vertexai: true,
      project: requireOption(options.vertexAi.projectId, "projectId", "Vertex Gemini"),
      location: requireOption(options.vertexAi.location, "location", "Vertex Gemini"),
      ...(options.vertexAi.googleAuthOptions === undefined
        ? {}
        : { googleAuthOptions: options.vertexAi.googleAuthOptions }),
    };
  }

  return {
    apiKey: requireOption(options.apiKey, "apiKey", "Gemini"),
  };
}

function requireOption(value: string | undefined, name: string, label: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing ${label} ${name}. Pass ${name} when constructing GeminiClient.`);
  }

  return value;
}

function requireModelId<ModelId extends string>(modelId: ModelId): ModelId {
  if (modelId.trim().length === 0) {
    throw new TypeError("modelId must be a non-empty string");
  }
  return modelId;
}

function validateOptionalPositiveSafeInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
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

  const listedModel: ModelList["data"][number] = {
    id,
  };
  if (typeof model.displayName === "string") {
    listedModel.name = model.displayName;
  }
  if (typeof model.display_name === "string") {
    listedModel.name = model.display_name;
  }
  if (typeof model.description === "string") {
    listedModel.description = model.description;
  }
  if (typeof model.type === "string") {
    listedModel.type = model.type;
  }
  if (typeof model.inputTokenLimit === "number") {
    listedModel.contextLength = model.inputTokenLimit;
  }
  if (typeof model.input_token_limit === "number") {
    listedModel.contextLength = model.input_token_limit;
  }
  return listedModel;
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
