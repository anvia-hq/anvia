import {
  type CompletionModelControls,
  defineCompletionModelControls,
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { DecisionModel } from "@anvia/core/decision";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import type { ImageGenerationModel } from "@anvia/core/image-generation";
import {
  rejectManagedOptionsWithInjectedClient,
  requireApiKey,
  requireModelId,
  validateOptionalPositiveSafeInteger,
} from "@anvia/core/internal/provider";
import type { ModelList, ModelListingClient } from "@anvia/core/model-listing";
import type { SpeechGenerationModel } from "@anvia/core/speech-generation";
import type { TranscriptionModel } from "@anvia/core/transcription";
import OpenAI from "openai";
import { OpenAIChatCompletionModel } from "./chat-completion";
import { type OpenAIControlsFor, openAIControlsForModel } from "./controls";
import { OpenAIDecisionModel } from "./decision";
import { OpenAIEmbeddingModel, type OpenAIEmbeddingModelOptions } from "./embedding";
import { OpenAIImageGenerationModel } from "./image-generation";
import { listOpenAIModels } from "./model-listing";
import type {
  OpenAICompletionModelId,
  OpenAIDecisionModelId,
  OpenAIImageGenerationModelId,
  OpenAISpeechGenerationModelId,
  OpenAITranscriptionModelId,
} from "./models";
import { OPENAI_COMPLETION_MODEL_CONTEXT_LIMITS } from "./models";
import { OpenAIResponsesCompletionModel } from "./responses";
import { OpenAISpeechGenerationModel } from "./speech-generation";
import { OpenAITranscriptionModel } from "./transcription";

type OpenAIManagedClientOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  client?: never;
};

type OpenAIInjectedClientOptions = {
  client: OpenAI;
  apiKey?: never;
  baseUrl?: never;
  headers?: never;
};

export type OpenAIClientOptions = OpenAIManagedClientOptions | OpenAIInjectedClientOptions;

export type OpenAICompletionModelOptions<
  ModelId extends OpenAICompletionModelId = OpenAICompletionModelId,
  Controls extends CompletionModelControls = OpenAIControlsFor<ModelId>,
> = {
  modelId: ModelId;
  api?: "responses" | "chat" | undefined;
  contextLimits?: ModelContextLimits | undefined;
  controls?: Controls | undefined;
};

export type OpenAIImageGenerationModelOptions = { modelId: OpenAIImageGenerationModelId };
export type OpenAIDecisionModelOptions = { modelId: OpenAIDecisionModelId };
export type OpenAIDecisionModelHandle = DecisionModel<unknown>;
export type OpenAISpeechGenerationModelOptions = { modelId: OpenAISpeechGenerationModelId };
export type OpenAITranscriptionModelOptions = { modelId: OpenAITranscriptionModelId };

export type OpenAICompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> = StreamingCompletionModel<unknown, Controls>;
export type OpenAICompletionModelHandle<
  Controls extends CompletionModelControls = CompletionModelControls,
> = OpenAICompletionModel<Controls>;
export type OpenAIEmbeddingModelHandle = EmbeddingModel;
export type OpenAIImageGenerationModelHandle = ImageGenerationModel<unknown>;
export type OpenAISpeechGenerationModelHandle = SpeechGenerationModel<unknown>;
export type OpenAITranscriptionModelHandle = TranscriptionModel<unknown>;

export class OpenAIClient implements ModelListingClient {
  private readonly sdk: OpenAI;

  constructor(options: OpenAIClientOptions) {
    if (options.client !== undefined) {
      rejectManagedOptionsWithInjectedClient("OpenAIClient", options, [
        "apiKey",
        "baseUrl",
        "headers",
      ]);
      this.sdk = options.client;
      return;
    }

    this.sdk = new OpenAI({
      apiKey: requireApiKey("OpenAI", "OpenAIClient", options.apiKey),
      baseURL: options.baseUrl,
      defaultHeaders: options.headers,
      maxRetries: 0,
    });
  }

  decisionModel(options: OpenAIDecisionModelOptions): OpenAIDecisionModelHandle {
    return new OpenAIDecisionModel(this.sdk, requireModelId(options.modelId));
  }

  completionModel<
    const ModelId extends OpenAICompletionModelId,
    const Controls extends CompletionModelControls = OpenAIControlsFor<ModelId>,
  >(options: OpenAICompletionModelOptions<ModelId, Controls>): OpenAICompletionModel<Controls> {
    const modelId = requireModelId(options.modelId);
    const controls = (
      options.controls === undefined
        ? openAIControlsForModel(modelId)
        : defineCompletionModelControls(options.controls)
    ) as Controls | undefined;
    const contextLimits = resolveModelContextLimits(
      modelId,
      OPENAI_COMPLETION_MODEL_CONTEXT_LIMITS,
      options.contextLimits,
    );
    return options.api === "responses"
      ? new OpenAIResponsesCompletionModel(this.sdk, modelId, contextLimits, controls)
      : new OpenAIChatCompletionModel(this.sdk, modelId, contextLimits, controls);
  }

  embeddingModel(options: OpenAIEmbeddingModelOptions): OpenAIEmbeddingModelHandle {
    requireModelId(options.modelId);
    validateOptionalPositiveSafeInteger(options.dimensions, "dimensions");
    validateOptionalPositiveSafeInteger(options.maxBatchSize, "maxBatchSize");
    return new OpenAIEmbeddingModel(this.sdk, options);
  }

  imageGenerationModel(
    options: OpenAIImageGenerationModelOptions,
  ): OpenAIImageGenerationModelHandle {
    return new OpenAIImageGenerationModel(this.sdk, requireModelId(options.modelId));
  }

  speechGenerationModel(
    options: OpenAISpeechGenerationModelOptions,
  ): OpenAISpeechGenerationModelHandle {
    return new OpenAISpeechGenerationModel(this.sdk, requireModelId(options.modelId));
  }

  transcriptionModel(options: OpenAITranscriptionModelOptions): OpenAITranscriptionModelHandle {
    return new OpenAITranscriptionModel(this.sdk, requireModelId(options.modelId));
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    return listOpenAIModels(this.sdk, options);
  }
}
