import type Anthropic from "@anthropic-ai/sdk";
import {
  collectModelsFromResponse,
  isListedModel,
  isObject,
  toModelListingError,
} from "@anvia/core/internal/provider";
import type { ModelList } from "@anvia/core/model-listing";

export async function listAnthropicModels(
  sdk: Anthropic,
  options: { abortSignal?: AbortSignal | undefined } = {},
): Promise<ModelList> {
  try {
    const response = await sdk.models.list(undefined, {
      signal: options.abortSignal,
      maxRetries: 0,
    });
    const data = (await collectModelsFromResponse(response))
      .map(toListedAnthropicModel)
      .filter(isListedModel);
    return { data };
  } catch (error) {
    throw toModelListingError("Anthropic", error);
  }
}

function toListedAnthropicModel(model: unknown): ModelList["data"][number] | undefined {
  if (!isObject(model) || typeof model.id !== "string") {
    return undefined;
  }

  let createdAt: number | undefined;

  if (typeof model.created_at === "string") {
    createdAt = secondsFromDateString(model.created_at);
  } else if (typeof model.created_at === "number") {
    createdAt = model.created_at;
  }

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
