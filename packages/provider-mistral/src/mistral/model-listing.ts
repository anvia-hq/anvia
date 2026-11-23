import {
  collectModelsFromResponse,
  isListedModel,
  isObject,
  toModelListingError,
} from "@anvia/core/internal/provider";
import type { ModelList } from "@anvia/core/model-listing";
import type { Mistral } from "@mistralai/mistralai";

export async function listMistralModels(
  sdk: Mistral,
  options: { abortSignal?: AbortSignal | undefined } = {},
): Promise<ModelList> {
  try {
    const requestOptions: NonNullable<Parameters<typeof sdk.models.list>[1]> = {
      retries: { strategy: "none" },
    };

    if (options.abortSignal !== undefined) {
      Object.assign(requestOptions, { signal: options.abortSignal });
    }

    const response = await sdk.models.list(undefined, requestOptions);
    const data = (await collectModelsFromResponse(response))
      .map(toListedMistralModel)
      .filter(isListedModel);
    return { data };
  } catch (error) {
    throw toModelListingError("Mistral", error);
  }
}

function toListedMistralModel(model: unknown): ModelList["data"][number] | undefined {
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
