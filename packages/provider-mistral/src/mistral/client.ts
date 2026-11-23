import {
  type ModelContextLimits,
  type NoCompletionModelControls,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import {
  rejectManagedOptionsWithInjectedClient,
  requireApiKey,
  requireModelId,
  validateOptionalPositiveSafeInteger,
} from "@anvia/core/internal/provider";
import type { ModelList, ModelListingClient } from "@anvia/core/model-listing";
import { Mistral } from "@mistralai/mistralai";
import { MistralCompletionModel } from "./completion";
import { MistralEmbeddingModel, type MistralEmbeddingModelOptions } from "./embedding";
import { listMistralModels } from "./model-listing";
import type { MistralCompletionModelId, MistralOcrModelId } from "./models";
import { MISTRAL_COMPLETION_MODEL_CONTEXT_LIMITS } from "./models";
import { MistralOcrModel } from "./ocr";

type MistralManagedClientOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  client?: never;
};

type MistralInjectedClientOptions = {
  client: Mistral;
  apiKey?: never;
  baseUrl?: never;
};

export type MistralClientOptions = MistralManagedClientOptions | MistralInjectedClientOptions;

export type MistralCompletionModelOptions = {
  modelId: MistralCompletionModelId;
  contextLimits?: ModelContextLimits | undefined;
};

export type MistralOcrModelOptions = { modelId: MistralOcrModelId };
export type MistralCompletionModelHandle = StreamingCompletionModel<
  unknown,
  NoCompletionModelControls
>;
export type MistralEmbeddingModelHandle = EmbeddingModel;
export type MistralOcrModelHandle = Pick<MistralOcrModel, "provider" | "modelId" | "ocr">;

export class MistralClient implements ModelListingClient {
  private readonly sdk: Mistral;

  constructor(options: MistralClientOptions) {
    if (options.client !== undefined) {
      rejectManagedOptionsWithInjectedClient("MistralClient", options, ["apiKey", "baseUrl"]);
      this.sdk = options.client;
      return;
    }

    this.sdk = new Mistral({
      apiKey: requireApiKey("Mistral", "MistralClient", options.apiKey),
      serverURL: options.baseUrl,
      retryConfig: { strategy: "none" },
    });
  }

  completionModel(options: MistralCompletionModelOptions): MistralCompletionModelHandle {
    const modelId = requireModelId(options.modelId);
    return new MistralCompletionModel(
      this.sdk,
      modelId,
      resolveModelContextLimits(
        modelId,
        MISTRAL_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
    );
  }

  embeddingModel(options: MistralEmbeddingModelOptions): MistralEmbeddingModelHandle {
    requireModelId(options.modelId);
    validateOptionalPositiveSafeInteger(options.dimensions, "dimensions");
    validateOptionalPositiveSafeInteger(options.maxBatchSize, "maxBatchSize");
    return new MistralEmbeddingModel(this.sdk, options);
  }

  ocrModel(options: MistralOcrModelOptions): MistralOcrModelHandle {
    return new MistralOcrModel(this.sdk, requireModelId(options.modelId));
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    return listMistralModels(this.sdk, options);
  }
}
