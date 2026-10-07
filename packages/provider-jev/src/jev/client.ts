import type { DecisionModel } from "@anvia/core/decision";
import {
  ModelListingError,
  type ModelList,
  type ModelListingClient,
} from "@anvia/core/model-listing";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { JevDecisionModel } from "./decision";
import type { JevDecisionModelId } from "./models";
import { normalizeJevError } from "./errors";

export type JevClientOptions =
  | {
      apiKey?: string | undefined;
      baseUrl?: string | undefined;
      headers?: Record<string, string> | undefined;
      client?: never;
    }
  | {
      client: TypeSafeClient;
      apiKey?: never;
      baseUrl?: never;
      headers?: never;
    };

export type JevDecisionModelOptions = { modelId: JevDecisionModelId };
export type JevDecisionModelHandle = DecisionModel<unknown>;

export class JevClient implements ModelListingClient {
  private readonly sdk: TypeSafeClient;

  constructor(options: JevClientOptions) {
    if (options.client !== undefined) {
      if (["apiKey", "baseUrl", "headers"].some((key) => key in options)) {
        throw new TypeError("JevClient cannot combine an injected client with managed options.");
      }
      this.sdk = options.client;
      return;
    }
    const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new TypeError("JevClient requires apiKey or TYPESAFE_API_KEY.");
    }
    this.sdk = new TypeSafeClient({
      apiKey,
      ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
      ...(options.headers === undefined ? {} : { defaultHeaders: options.headers }),
      retry: { maxRetries: 0 },
      logLevel: "off",
    });
  }

  decisionModel(options: JevDecisionModelOptions): JevDecisionModelHandle {
    if (typeof options.modelId !== "string" || options.modelId.trim().length === 0) {
      throw new TypeError("Jev modelId must be a non-empty string.");
    }
    return new JevDecisionModel(this.sdk, options.modelId);
  }

  async listModels(options?: { abortSignal?: AbortSignal | undefined }): Promise<ModelList> {
    try {
      const models = await this.sdk.models.list({
        ...(options?.abortSignal === undefined ? {} : { signal: options.abortSignal }),
        retry: { maxRetries: 0 },
      });
      if (
        !Array.isArray(models) ||
        models.some(
          (model) =>
            typeof model?.name !== "string" ||
            typeof model.description !== "string" ||
            typeof model.release_date !== "string",
        )
      ) {
        throw new TypeError("Jev returned invalid model metadata.");
      }
      return {
        data: models.map((model) => ({
          id: model.name,
          name: model.name,
          description: model.description,
          type: "decision",
        })),
      };
    } catch (error) {
      const normalized = normalizeJevError(error, options?.abortSignal);
      if (options?.abortSignal?.aborted) {
        throw normalized;
      }
      throw new ModelListingError("Failed to list Jev models.", {
        provider: "jev",
        cause: normalized,
      });
    }
  }
}
