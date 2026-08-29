import {
  type CompletionModelControls,
  defineCompletionModelControls,
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
import type { SpeechGenerationModel } from "@anvia/core/speech-generation";
import type { TranscriptionModel } from "@anvia/core/transcription";
import OpenAI from "openai";
import { OpenAIChatCompletionModel } from "./chat-completion";
import { type OpenAIControlsFor, openAIControlsForModel } from "./controls";
import { OpenAIEmbeddingModel, type OpenAIEmbeddingModelOptions } from "./embedding";
import { OpenAIImageGenerationModel } from "./image-generation";
import type {
  OpenAICompletionModelId,
  OpenAIImageGenerationModelId,
  OpenAISpeechGenerationModelId,
  OpenAITranscriptionModelId,
} from "./models";
import { OPENAI_COMPLETION_MODEL_CONTEXT_LIMITS } from "./models";
import { OpenAIResponsesCompletionModel } from "./responses";
import { OpenAISpeechGenerationModel } from "./speech-generation";
import { OpenAITranscriptionModel } from "./transcription";

type OpenAIManagedClientOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  client?: never;
};

type OpenAIInjectedClientOptions = {
  client: OpenAI;
  apiKey?: never;
  baseUrl?: never;
  headers?: never;
};

export type OpenAIClientOptions = OpenAIManagedClientOptions | OpenAIInjectedClientOptions;

export type OpenAICompletionModelOptions<
  ModelId extends OpenAICompletionModelId = OpenAICompletionModelId,
  Controls extends CompletionModelControls = OpenAIControlsFor<ModelId>,
> = {
  modelId: ModelId;
  api: "responses" | "chat";
  contextLimits?: ModelContextLimits | undefined;
  controls?: Controls | undefined;
};

export type OpenAIImageGenerationModelOptions = { modelId: OpenAIImageGenerationModelId };
export type OpenAISpeechGenerationModelOptions = { modelId: OpenAISpeechGenerationModelId };
export type OpenAITranscriptionModelOptions = { modelId: OpenAITranscriptionModelId };

export type OpenAICompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> = StreamingCompletionModel<unknown, Controls>;
export type OpenAIEmbeddingModelHandle = EmbeddingModel;
export type OpenAIImageGenerationModelHandle = ImageGenerationModel<unknown>;
export type OpenAISpeechGenerationModelHandle = SpeechGenerationModel<unknown>;
export type OpenAITranscriptionModelHandle = TranscriptionModel<unknown>;

export class OpenAIClient implements ModelListingClient {
  private readonly sdk: OpenAI;

  constructor(options: OpenAIClientOptions) {
    if (options.client !== undefined) {
      rejectManagedOptionsWithInjectedClient(options, ["apiKey", "baseUrl", "headers"]);
      this.sdk = options.client;
      return;
    }
    this.sdk = new OpenAI({
      apiKey: requireApiKey(options.apiKey),
      baseURL: options.baseUrl,
      defaultHeaders: options.headers,
      maxRetries: 0,
    });
  }

  completionModel<
    const ModelId extends OpenAICompletionModelId,
    const Controls extends CompletionModelControls = OpenAIControlsFor<ModelId>,
  >(options: OpenAICompletionModelOptions<ModelId, Controls>): OpenAICompletionModel<Controls> {
    const modelId = requireModelId(options.modelId);
    const controls = (
      options.controls === undefined
        ? openAIControlsForModel(modelId)
        : defineCompletionModelControls(options.controls)
    ) as Controls | undefined;
    const contextLimits = resolveModelContextLimits(
      modelId,
      OPENAI_COMPLETION_MODEL_CONTEXT_LIMITS,
      options.contextLimits,
    );
    return options.api === "chat"
      ? new OpenAIChatCompletionModel(this.sdk, modelId, contextLimits, controls)
      : new OpenAIResponsesCompletionModel(this.sdk, modelId, contextLimits, controls);
  }

  embeddingModel(options: OpenAIEmbeddingModelOptions): OpenAIEmbeddingModelHandle {
    requireModelId(options.modelId);
    validateOptionalPositiveSafeInteger(options.dimensions, "dimensions");
    validateOptionalPositiveSafeInteger(options.maxBatchSize, "maxBatchSize");
    return new OpenAIEmbeddingModel(this.sdk, options);
  }

  imageGenerationModel(
    options: OpenAIImageGenerationModelOptions,
  ): OpenAIImageGenerationModelHandle {
    return new OpenAIImageGenerationModel(this.sdk, requireModelId(options.modelId));
  }

  speechGenerationModel(
    options: OpenAISpeechGenerationModelOptions,
  ): OpenAISpeechGenerationModelHandle {
    return new OpenAISpeechGenerationModel(this.sdk, requireModelId(options.modelId));
  }

  transcriptionModel(options: OpenAITranscriptionModelOptions): OpenAITranscriptionModelHandle {
    return new OpenAITranscriptionModel(this.sdk, requireModelId(options.modelId));
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    try {
      const response = await this.sdk.models.list({
        signal: options.abortSignal,
        maxRetries: 0,
      });
      const data = (await collectModelsFromResponse(response))
        .map(toListedModel)
        .filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("OpenAI", error);
    }
  }
}

function rejectManagedOptionsWithInjectedClient(options: object, keys: readonly string[]): void {
  const conflict = keys.find((key) => key in options);
  if (conflict !== undefined) {
    throw new TypeError(`OpenAIClient cannot combine client with ${conflict}.`);
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("Missing OpenAI credentials. Pass apiKey when constructing OpenAIClient.");
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
  } else if (typeof model.object === "string") {
    listedModel.type = model.object;
  }
  if (typeof model.created === "number") {
    listedModel.createdAt = model.created;
  }
  if (typeof model.created_at === "number") {
    listedModel.createdAt = model.created_at;
  }
  if (typeof model.owned_by === "string") {
    listedModel.ownedBy = model.owned_by;
  }
  if (typeof model.context_length === "number") {
    listedModel.contextLength = model.context_length;
  }
  if (typeof model.contextLength === "number") {
    listedModel.contextLength = model.contextLength;
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

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return isObject(value) && Symbol.asyncIterator in value;
}
