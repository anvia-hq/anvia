import type { StreamingCompletionModel } from "@anvia/core/completion";
import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import OpenAI from "openai";
import { OpenAIAudioGenerationModel, TTS_1 } from "./audio-generation";
import { OpenAIChatCompletionModel } from "./chat-completion";
import { OpenAIEmbeddingModel, type ProviderEmbeddingModelOptions } from "./embedding";
import { GPT_IMAGE_1, OpenAIImageGenerationModel } from "./image-generation";
import type {
  OpenAIAudioGenerationModelName,
  OpenAICompletionModelName,
  OpenAIEmbeddingModelName,
  OpenAIImageGenerationModelName,
  OpenAITranscriptionModelName,
} from "./models";
import { OpenAIResponsesCompletionModel } from "./responses";
import { OpenAITranscriptionModel, WHISPER_1 } from "./transcription";

export type OpenAIClientOptions = {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  completionApi?: "responses" | "chat" | undefined;
  client?: OpenAI | undefined;
};

export class OpenAIClient implements ModelListingClient {
  readonly client: OpenAI;
  private readonly completionApi: "responses" | "chat";

  constructor(options: OpenAIClientOptions = {}) {
    this.completionApi =
      options.completionApi ?? (options.baseUrl === undefined ? "responses" : "chat");
    this.client =
      options.client ??
      new OpenAI({
        apiKey: requireApiKey(options.apiKey),
        baseURL: options.baseUrl,
        defaultHeaders: options.headers,
      });
  }

  completionModel(
    model: OpenAICompletionModelName = "gpt-5",
  ): StreamingCompletionModel<unknown, OpenAICompletionModelName> {
    return this.completionApi === "chat"
      ? new OpenAIChatCompletionModel(this.client, model)
      : new OpenAIResponsesCompletionModel(this.client, model);
  }

  embeddingModel(
    model: OpenAIEmbeddingModelName = "text-embedding-3-small",
    options: ProviderEmbeddingModelOptions = {},
  ): OpenAIEmbeddingModel {
    return new OpenAIEmbeddingModel(this.client, model, options);
  }

  imageGenerationModel(
    model: OpenAIImageGenerationModelName = GPT_IMAGE_1,
  ): OpenAIImageGenerationModel {
    return new OpenAIImageGenerationModel(this.client, model);
  }

  audioGenerationModel(model: OpenAIAudioGenerationModelName = TTS_1): OpenAIAudioGenerationModel {
    return new OpenAIAudioGenerationModel(this.client, model);
  }

  transcriptionModel(model: OpenAITranscriptionModelName = WHISPER_1): OpenAITranscriptionModel {
    return new OpenAITranscriptionModel(this.client, model);
  }

  async listModels(): Promise<ModelList> {
    try {
      const response = await this.client.models.list();
      const data = (await collectModelsFromResponse(response))
        .map(toListedModel)
        .filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("OpenAI", error);
    }
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Missing OpenAI credentials. Pass apiKey when constructing OpenAIClient.");
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
