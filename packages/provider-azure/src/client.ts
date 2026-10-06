import type { CompletionModelControls } from "@anvia/core/completion";
import {
  type ModelList,
  type ModelListingClient,
  ModelListingError,
} from "@anvia/core/model-listing";
import {
  OpenAIClient,
  type OpenAICompletionModel,
  type OpenAICompletionModelId,
  type OpenAICompletionModelOptions,
  type OpenAIControlsFor,
  type OpenAIEmbeddingModelHandle,
  type OpenAIEmbeddingModelOptions,
  type OpenAIImageGenerationModelHandle,
  type OpenAIImageGenerationModelOptions,
  type OpenAISpeechGenerationModelHandle,
  type OpenAISpeechGenerationModelOptions,
  type OpenAITranscriptionModelHandle,
  type OpenAITranscriptionModelOptions,
} from "@anvia/openai";
import type OpenAI from "openai";
import { AzureOpenAIResponsesCompletionModel } from "./responses";
import { type AzureOpenAIClientOptions, createAzureOpenAISdk } from "./sdk";

export class AzureOpenAIClient implements ModelListingClient {
  private readonly adapter: OpenAIClient;
  private readonly sdk: OpenAI;

  constructor(options: AzureOpenAIClientOptions) {
    this.sdk = createAzureOpenAISdk(options);
    this.adapter = new OpenAIClient({ client: this.sdk });
  }

  completionModel<
    const ModelId extends OpenAICompletionModelId,
    const Controls extends CompletionModelControls = OpenAIControlsFor<ModelId>,
  >(options: OpenAICompletionModelOptions<ModelId, Controls>): OpenAICompletionModel<Controls> {
    const model = this.adapter.completionModel(options);
    if (options.api === "responses") {
      return new AzureOpenAIResponsesCompletionModel(
        this.sdk,
        model.modelId,
        model.contextLimits,
        model.controls,
      );
    }
    return {
      provider: "azure-openai",
      modelId: model.modelId,
      capabilities: model.capabilities,
      contextLimits: model.contextLimits,
      controls: model.controls,
      completion: (request, callOptions) => model.completion(request, callOptions),
      streamCompletion: (request, callOptions) => model.streamCompletion(request, callOptions),
      traceRequest: (request, traceOptions) => {
        const trace = model.traceRequest?.(request, traceOptions);
        return trace === undefined
          ? undefined
          : {
              ...trace,
              provider: "azure-openai-chat",
            };
      },
    };
  }

  embeddingModel(options: OpenAIEmbeddingModelOptions): OpenAIEmbeddingModelHandle {
    const model = this.adapter.embeddingModel(options);
    return {
      provider: "azure-openai",
      modelId: model.modelId,
      dimensions: model.dimensions,
      maxBatchSize: model.maxBatchSize,
      embedTexts: (texts, callOptions) => model.embedTexts(texts, callOptions),
    };
  }

  imageGenerationModel(
    options: OpenAIImageGenerationModelOptions,
  ): OpenAIImageGenerationModelHandle {
    const model = this.adapter.imageGenerationModel(options);
    return {
      provider: "azure-openai",
      modelId: model.modelId,
      imageGeneration: (request, callOptions) => model.imageGeneration(request, callOptions),
    };
  }

  speechGenerationModel(
    options: OpenAISpeechGenerationModelOptions,
  ): OpenAISpeechGenerationModelHandle {
    const model = this.adapter.speechGenerationModel(options);
    return {
      provider: "azure-openai",
      modelId: model.modelId,
      speechGeneration: (request, callOptions) => model.speechGeneration(request, callOptions),
    };
  }

  transcriptionModel(options: OpenAITranscriptionModelOptions): OpenAITranscriptionModelHandle {
    const model = this.adapter.transcriptionModel(options);
    return {
      provider: "azure-openai",
      modelId: model.modelId,
      transcription: (request, callOptions) => model.transcription(request, callOptions),
    };
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    try {
      return await this.adapter.listModels(options);
    } catch (error) {
      throw new ModelListingError("Azure OpenAI model listing failed.", {
        provider: "azure-openai",
        statusCode: error instanceof ModelListingError ? error.statusCode : undefined,
        cause: error,
      });
    }
  }
}
