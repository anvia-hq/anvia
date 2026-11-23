import { ModelListingError, type ListedModel } from "../../model-listing/index";
import { isObject } from "./values";

export function rejectManagedOptionsWithInjectedClient(
  clientName: string,
  options: object,
  keys: readonly string[],
): void {
  const conflict = keys.find((key) => key in options);

  if (conflict !== undefined) {
    throw new TypeError(`${clientName} cannot combine client with ${conflict}.`);
  }
}

export function requireApiKey(providerLabel: string, clientName: string, apiKey: unknown): string {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error(
      `Missing ${providerLabel} credentials. Pass apiKey when constructing ${clientName}.`,
    );
  }

  return apiKey;
}

export function requireModelId<ModelId extends string>(modelId: ModelId): ModelId {
  if (typeof modelId !== "string" || modelId.trim().length === 0) {
    throw new TypeError("modelId must be a non-empty string");
  }

  return modelId;
}

export function validateOptionalPositiveSafeInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

export async function collectModelsFromResponse(
  response: unknown,
  options: { includeModelsKey?: boolean } = {},
): Promise<unknown[]> {
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

  if (options.includeModelsKey === true && isObject(response) && Array.isArray(response.models)) {
    return response.models;
  }

  if (isObject(response) && Array.isArray(response.data)) {
    return response.data;
  }

  return [];
}

export function isListedModel(model: ListedModel | undefined): model is ListedModel {
  return model !== undefined;
}

export function toModelListingError(provider: string, error: unknown): ModelListingError {
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

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return isObject(value) && Symbol.asyncIterator in value;
}
