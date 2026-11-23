import {
  collectModelsFromResponse,
  isListedModel,
  isObject,
  toModelListingError,
} from "@anvia/core/internal/provider";
import type { ModelList } from "@anvia/core/model-listing";
import type OpenAI from "openai";

export async function listGrokModels(
  sdk: OpenAI,
  options: { abortSignal?: AbortSignal | undefined } = {},
): Promise<ModelList> {
  try {
    const response = await sdk.models.list({
      signal: options.abortSignal,
      maxRetries: 0,
    });
    const data = (await collectModelsFromResponse(response))
      .map(toListedGrokModel)
      .filter(isListedModel);
    return { data };
  } catch (error) {
    throw toModelListingError("grok", error);
  }
}

function toListedGrokModel(model: unknown): ModelList["data"][number] | undefined {
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
