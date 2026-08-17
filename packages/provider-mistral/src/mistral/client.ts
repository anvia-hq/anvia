import {
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import { Mistral } from "@mistralai/mistralai";
import { MistralCompletionModel } from "./completion";
import { MistralEmbeddingModel, type MistralEmbeddingModelOptions } from "./embedding";
import type { MistralCompletionModelId, MistralOcrModelId } from "./models";
import { MISTRAL_COMPLETION_MODEL_CONTEXT_LIMITS } from "./models";
import { MistralOcrModel } from "./ocr";

type MistralManagedClientOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  client?: never;
};

type MistralInjectedClientOptions = {
  client: Mistral;
  apiKey?: never;
  baseUrl?: never;
};

export type MistralClientOptions = MistralManagedClientOptions | MistralInjectedClientOptions;

export type MistralCompletionModelOptions = {
  modelId: MistralCompletionModelId;
  contextLimits?: ModelContextLimits | undefined;
};

export type MistralOcrModelOptions = { modelId: MistralOcrModelId };
export type MistralCompletionModelHandle = StreamingCompletionModel<unknown>;
export type MistralEmbeddingModelHandle = EmbeddingModel;
export type MistralOcrModelHandle = Pick<MistralOcrModel, "provider" | "modelId" | "ocr">;

export class MistralClient implements ModelListingClient {
  private readonly sdk: Mistral;

  constructor(options: MistralClientOptions) {
    if (options.client !== undefined) {
      rejectManagedOptionsWithInjectedClient(options, ["apiKey", "baseUrl"]);
      this.sdk = options.client;
      return;
    }
    this.sdk = new Mistral({
      apiKey: requireApiKey(options.apiKey),
      serverURL: options.baseUrl,
      retryConfig: { strategy: "none" },
    });
  }

  completionModel(options: MistralCompletionModelOptions): MistralCompletionModelHandle {
    const modelId = requireModelId(options.modelId);
    return new MistralCompletionModel(
      this.sdk,
      modelId,
      resolveModelContextLimits(
        modelId,
        MISTRAL_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
    );
  }

  embeddingModel(options: MistralEmbeddingModelOptions): MistralEmbeddingModelHandle {
    requireModelId(options.modelId);
    validateOptionalPositiveSafeInteger(options.dimensions, "dimensions");
    validateOptionalPositiveSafeInteger(options.maxBatchSize, "maxBatchSize");
    return new MistralEmbeddingModel(this.sdk, options);
  }

  ocrModel(options: MistralOcrModelOptions): MistralOcrModelHandle {
    return new MistralOcrModel(this.sdk, requireModelId(options.modelId));
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    try {
      const requestOptions: NonNullable<Parameters<typeof this.sdk.models.list>[1]> = {
        retries: { strategy: "none" },
      };
      if (options.abortSignal !== undefined) {
        Object.assign(requestOptions, { signal: options.abortSignal });
      }
      const response = await this.sdk.models.list(undefined, requestOptions);
      const data = collectModelsFromResponse(response).map(toListedModel).filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("Mistral", error);
    }
  }
}

function rejectManagedOptionsWithInjectedClient(options: object, keys: readonly string[]): void {
  const conflict = keys.find((key) => key in options);
  if (conflict !== undefined) {
    throw new TypeError(`MistralClient cannot combine client with ${conflict}.`);
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("Missing Mistral credentials. Pass apiKey when constructing MistralClient.");
  }

  return apiKey;
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
