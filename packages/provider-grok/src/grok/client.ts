import {
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { ImageGenerationModel } from "@anvia/core/image-generation";
import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import type { SpeechGenerationModel } from "@anvia/core/speech-generation";
import type { TranscriptionModel } from "@anvia/core/transcription";
import OpenAI from "openai";
import { GrokCompletionModel } from "./completion";
import { XAI_BASE_URL } from "./constants";
import type { GrokHttpOptions } from "./http";
import { GrokImageGenerationModel } from "./image-generation";
import type { GrokCompletionModelId, GrokImageGenerationModelId } from "./models";
import { GROK_COMPLETION_MODEL_CONTEXT_LIMITS } from "./models";
import { GrokSpeechGenerationModel } from "./speech-generation";
import { GrokTranscriptionModel } from "./transcription";

type GrokManagedClientOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  fetch?: typeof fetch | undefined;
  client?: never;
  http?: never;
};

type GrokInjectedClientOptions = {
  client: OpenAI;
  http: {
    apiKey: string;
    baseUrl?: string | undefined;
    headers?: Record<string, string> | undefined;
    fetch?: typeof fetch | undefined;
  };
  apiKey?: never;
  baseUrl?: never;
  headers?: never;
  fetch?: never;
};

export type GrokClientOptions = GrokManagedClientOptions | GrokInjectedClientOptions;

export type GrokCompletionModelOptions = {
  modelId: GrokCompletionModelId;
  api: "responses" | "chat";
  contextLimits?: ModelContextLimits | undefined;
};

export type GrokImageGenerationModelOptions = { modelId: GrokImageGenerationModelId };
export type GrokCompletionModelHandle = StreamingCompletionModel<unknown>;
export type GrokImageGenerationModelHandle = ImageGenerationModel<unknown>;
export type GrokSpeechGenerationModelHandle = SpeechGenerationModel<unknown>;
export type GrokTranscriptionModelHandle = TranscriptionModel<unknown>;

export class GrokClient implements ModelListingClient {
  private readonly sdk: OpenAI;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly httpOptions: GrokHttpOptions;

  constructor(options: GrokClientOptions) {
    const managed = options.client === undefined;
    if (managed) {
      if ("http" in options) {
        throw new TypeError("GrokClient cannot combine managed credentials with http.");
      }
    } else {
      rejectManagedOptionsWithInjectedClient(options, ["apiKey", "baseUrl", "headers", "fetch"]);
    }
    const http = managed
      ? {
          apiKey: requireApiKey(options.apiKey),
          baseUrl: options.baseUrl ?? XAI_BASE_URL,
          headers: options.headers,
          fetch: options.fetch,
        }
      : {
          apiKey: requireApiKey(options.http.apiKey),
          baseUrl: options.http.baseUrl ?? XAI_BASE_URL,
          headers: options.http.headers,
          fetch: options.http.fetch,
        };
    this.sdk =
      options.client ??
      new OpenAI({
        apiKey: http.apiKey,
        baseURL: http.baseUrl,
        defaultHeaders: http.headers,
        fetch: http.fetch,
        maxRetries: 0,
      });
    this.fetchFn = http.fetch ?? defaultFetch();
    this.httpOptions = {
      apiKey: http.apiKey,
      baseUrl: http.baseUrl,
      headers: http.headers,
      fetch: this.fetchFn,
    };
  }

  completionModel(options: GrokCompletionModelOptions): GrokCompletionModelHandle {
    const modelId = requireModelId(options.modelId);
    return new GrokCompletionModel(
      this.sdk,
      modelId,
      options.api,
      resolveModelContextLimits(
        modelId,
        GROK_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
    );
  }

  imageGenerationModel(options: GrokImageGenerationModelOptions): GrokImageGenerationModelHandle {
    return new GrokImageGenerationModel(this.sdk, requireModelId(options.modelId), this.fetchFn);
  }

  speechGenerationModel(): GrokSpeechGenerationModelHandle {
    return new GrokSpeechGenerationModel(this.httpOptions);
  }

  transcriptionModel(): GrokTranscriptionModelHandle {
    return new GrokTranscriptionModel(this.httpOptions);
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
      throw toModelListingError("grok", error);
    }
  }
}

function rejectManagedOptionsWithInjectedClient(options: object, keys: readonly string[]): void {
  const conflict = keys.find((key) => key in options);
  if (conflict !== undefined) {
    throw new TypeError(`GrokClient cannot combine client with ${conflict}.`);
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("Missing Grok credentials. Pass apiKey when constructing GrokClient.");
  }

  return apiKey;
}

function requireModelId<ModelId extends string>(modelId: ModelId): ModelId {
  if (modelId.trim().length === 0) {
    throw new TypeError("modelId must be a non-empty string");
  }
  return modelId;
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
