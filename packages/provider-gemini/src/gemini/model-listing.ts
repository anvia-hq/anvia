import {
  collectModelsFromResponse,
  isListedModel,
  isObject,
  toModelListingError,
} from "@anvia/core/internal/provider";
import type { ModelList } from "@anvia/core/model-listing";
import type { GoogleGenAI } from "@google/genai";
import { disableGeminiNativeRetries } from "./retry";

export async function listGeminiModels(
  sdk: GoogleGenAI,
  options: { abortSignal?: AbortSignal | undefined } = {},
): Promise<ModelList> {
  try {
    const config = { pageSize: 1000 };

    if (options.abortSignal !== undefined) {
      Object.assign(config, { abortSignal: options.abortSignal });
    }

    const response = await sdk.models.list({
      config: disableGeminiNativeRetries(config),
    });
    const data = (await collectModelsFromResponse(response, { includeModelsKey: true }))
      .map(toListedGeminiModel)
      .filter(isListedModel);
    return { data };
  } catch (error) {
    throw toModelListingError("Gemini", error);
  }
}

function toListedGeminiModel(model: unknown): ModelList["data"][number] | undefined {
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
