import {
  type CompletionModelControls,
  defineCompletionModelControls,
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import type { ImageGenerationModel } from "@anvia/core/image-generation";
import {
  rejectManagedOptionsWithInjectedClient,
  requireModelId,
  validateOptionalPositiveSafeInteger,
} from "@anvia/core/internal/provider";
import type { ModelList, ModelListingClient } from "@anvia/core/model-listing";
import type { TranscriptionModel } from "@anvia/core/transcription";
import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import { GeminiCompletionModel } from "./completion";
import { geminiControlsForModel, type GeminiControlsFor } from "./controls";
import { GeminiEmbeddingModel, type GeminiEmbeddingModelOptions } from "./embedding";
import { GeminiImageGenerationModel, GeminiImagenGenerationModel } from "./image-generation";
import { listGeminiModels } from "./model-listing";
import type {
  GeminiCompletionModelId,
  GeminiGenerateContentImageModelId,
  GeminiGenerateImagesModelId,
  GeminiTranscriptionModelId,
} from "./models";
import { GEMINI_COMPLETION_MODEL_CONTEXT_LIMITS } from "./models";
import { GeminiTranscriptionModel } from "./transcription";

type GeminiApiClientOptions = {
  apiKey: string;
  vertexAi?: never;
  client?: never;
};

type VertexClientOptions = {
  vertexAi: {
    projectId: string;
    location: string;
    googleAuthOptions?: GoogleGenAIOptions["googleAuthOptions"];
  };
  apiKey?: never;
  client?: never;
};

type InjectedClientOptions = {
  client: GoogleGenAI;
  apiKey?: never;
  vertexAi?: never;
};

export type GeminiClientOptions =
  | GeminiApiClientOptions
  | VertexClientOptions
  | InjectedClientOptions;

export type GeminiCompletionModelOptions<
  ModelId extends GeminiCompletionModelId = GeminiCompletionModelId,
  Controls extends CompletionModelControls = GeminiControlsFor<ModelId>,
> = {
  modelId: ModelId;
  contextLimits?: ModelContextLimits | undefined;
  controls?: Controls | undefined;
};

export type GeminiImageGenerationModelOptions =
  | { api: "generateContent"; modelId: GeminiGenerateContentImageModelId }
  | { api: "generateImages"; modelId: GeminiGenerateImagesModelId };

export type GeminiTranscriptionModelOptions = { modelId: GeminiTranscriptionModelId };

export type GeminiCompletionModelHandle<
  Controls extends CompletionModelControls = CompletionModelControls,
> = StreamingCompletionModel<unknown, Controls>;
export type GeminiEmbeddingModelHandle = EmbeddingModel;
export type GeminiImageGenerationModelHandle = ImageGenerationModel<unknown>;
export type GeminiTranscriptionModelHandle = TranscriptionModel<unknown>;

export class GeminiClient implements ModelListingClient {
  private readonly sdk: GoogleGenAI;

  constructor(options: GeminiClientOptions) {
    if (options.client !== undefined) {
      rejectManagedOptionsWithInjectedClient("GeminiClient", options, ["apiKey", "vertexAi"]);
      this.sdk = options.client;
      return;
    }

    this.sdk = new GoogleGenAI(toGoogleGenAIOptions(options));
  }

  completionModel<
    const ModelId extends GeminiCompletionModelId,
    const Controls extends CompletionModelControls = GeminiControlsFor<ModelId>,
  >(
    options: GeminiCompletionModelOptions<ModelId, Controls>,
  ): GeminiCompletionModelHandle<Controls> {
    const modelId = requireModelId(options.modelId);
    const controls = (
      options.controls === undefined
        ? geminiControlsForModel(modelId)
        : defineCompletionModelControls(options.controls)
    ) as Controls | undefined;
    return new GeminiCompletionModel(
      this.sdk,
      modelId,
      resolveModelContextLimits(
        modelId,
        GEMINI_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
      controls,
    );
  }

  embeddingModel(options: GeminiEmbeddingModelOptions): GeminiEmbeddingModelHandle {
    requireModelId(options.modelId);
    validateOptionalPositiveSafeInteger(options.dimensions, "dimensions");
    validateOptionalPositiveSafeInteger(options.maxBatchSize, "maxBatchSize");
    return new GeminiEmbeddingModel(this.sdk, options);
  }

  imageGenerationModel(
    options: GeminiImageGenerationModelOptions,
  ): GeminiImageGenerationModelHandle {
    const modelId = requireModelId(options.modelId);
    return options.api === "generateContent"
      ? new GeminiImageGenerationModel(this.sdk, modelId)
      : new GeminiImagenGenerationModel(this.sdk, modelId);
  }

  transcriptionModel(options: GeminiTranscriptionModelOptions): GeminiTranscriptionModelHandle {
    return new GeminiTranscriptionModel(this.sdk, requireModelId(options.modelId));
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    return listGeminiModels(this.sdk, options);
  }
}

export function toGoogleGenAIOptions(options: GeminiClientOptions): GoogleGenAIOptions {
  if ("client" in options && options.client !== undefined) {
    throw new TypeError("Injected Gemini clients do not have managed SDK options.");
  }

  if ("vertexAi" in options && options.vertexAi !== undefined) {
    const sdkOptions: GoogleGenAIOptions = {
      vertexai: true,
      project: requireOption(options.vertexAi.projectId, "projectId", "Vertex Gemini"),
      location: requireOption(options.vertexAi.location, "location", "Vertex Gemini"),
    };

    if (options.vertexAi.googleAuthOptions !== undefined) {
      sdkOptions.googleAuthOptions = options.vertexAi.googleAuthOptions;
    }

    return sdkOptions;
  }

  return {
    apiKey: requireOption(options.apiKey, "apiKey", "Gemini"),
  };
}

function requireOption(value: unknown, name: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${label} ${name}. Pass ${name} when constructing GeminiClient.`);
  }

  return value;
}
