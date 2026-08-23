import Anthropic from "@anthropic-ai/sdk";
import {
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import { AnthropicCompletionModel } from "./completion";
import {
  ANTHROPIC_COMPLETION_MODEL_CONTEXT_LIMITS,
  type AnthropicCompletionModelId,
} from "./models";

type AnthropicManagedClientOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  client?: never;
};

type AnthropicInjectedClientOptions = {
  client: Anthropic;
  apiKey?: never;
  baseUrl?: never;
};

export type AnthropicClientOptions = AnthropicManagedClientOptions | AnthropicInjectedClientOptions;

export type AnthropicCompletionModelOptions = {
  modelId: AnthropicCompletionModelId;
  contextLimits?: ModelContextLimits | undefined;
};

export type AnthropicCompletionModelHandle = StreamingCompletionModel<unknown>;

export class AnthropicClient implements ModelListingClient {
  private readonly sdk: Anthropic;

  constructor(options: AnthropicClientOptions) {
    if (options.client !== undefined) {
      rejectManagedOptionsWithInjectedClient(options, ["apiKey", "baseUrl"]);
      this.sdk = options.client;
      return;
    }
    this.sdk = new Anthropic({
      apiKey: requireApiKey(options.apiKey),
      baseURL: options.baseUrl,
      maxRetries: 0,
    });
  }

  completionModel(options: AnthropicCompletionModelOptions): AnthropicCompletionModelHandle {
    const modelId = requireModelId(options.modelId);
    return new AnthropicCompletionModel(
      this.sdk,
      modelId,
      resolveModelContextLimits(
        modelId,
        ANTHROPIC_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
    );
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    try {
      const response = await this.sdk.models.list(undefined, {
        signal: options.abortSignal,
        maxRetries: 0,
      });
      const data = (await collectModelsFromResponse(response))
        .map(toListedModel)
        .filter(isListedModel);
      return { data };
    } catch (error) {
      throw toModelListingError("Anthropic", error);
    }
  }
}

function rejectManagedOptionsWithInjectedClient(options: object, keys: readonly string[]): void {
  const conflict = keys.find((key) => key in options);
  if (conflict !== undefined) {
    throw new TypeError(`AnthropicClient cannot combine client with ${conflict}.`);
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(
      "Missing Anthropic credentials. Pass apiKey when constructing AnthropicClient.",
    );
  }

  return apiKey;
}

function requireModelId<ModelId extends string>(modelId: ModelId): ModelId {
  if (modelId.trim().length === 0) {
    throw new TypeError("modelId must be a non-empty string");
  }
  return modelId;
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
