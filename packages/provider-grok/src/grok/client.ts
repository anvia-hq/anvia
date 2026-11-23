import {
  type CompletionModelControls,
  defineCompletionModelControls,
  type ModelContextLimits,
  resolveModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { ImageGenerationModel } from "@anvia/core/image-generation";
import {
  rejectManagedOptionsWithInjectedClient,
  requireApiKey,
  requireModelId,
} from "@anvia/core/internal/provider";
import type { ModelList, ModelListingClient } from "@anvia/core/model-listing";
import type { SpeechGenerationModel } from "@anvia/core/speech-generation";
import type { TranscriptionModel } from "@anvia/core/transcription";
import { OpenAIClient } from "@anvia/openai";
import OpenAI from "openai";
import { GrokCompletionModel } from "./completion";
import { XAI_BASE_URL } from "./constants";
import { type GrokControlsFor, grokControlsForModel } from "./controls";
import type { GrokHttpOptions } from "./http";
import { GrokImageGenerationModel } from "./image-generation";
import { listGrokModels } from "./model-listing";
import type { GrokCompletionModelId, GrokImageGenerationModelId } from "./models";
import { GROK_COMPLETION_MODEL_CONTEXT_LIMITS } from "./models";
import { GrokSpeechGenerationModel } from "./speech-generation";
import { GrokTranscriptionModel } from "./transcription";

type GrokManagedClientOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  fetch?: typeof fetch | undefined;
  client?: never;
  http?: never;
};

type GrokInjectedClientOptions = {
  client: OpenAI;
  http: {
    apiKey: string;
    baseUrl?: string | undefined;
    headers?: Record<string, string> | undefined;
    fetch?: typeof fetch | undefined;
  };
  apiKey?: never;
  baseUrl?: never;
  headers?: never;
  fetch?: never;
};

export type GrokClientOptions = GrokManagedClientOptions | GrokInjectedClientOptions;

export type GrokCompletionModelOptions<
  ModelId extends GrokCompletionModelId = GrokCompletionModelId,
  Controls extends CompletionModelControls = GrokControlsFor<ModelId>,
> = {
  modelId: ModelId;
  api?: "responses" | "chat" | undefined;
  contextLimits?: ModelContextLimits | undefined;
  controls?: Controls | undefined;
};

export type GrokImageGenerationModelOptions = { modelId: GrokImageGenerationModelId };
export type GrokCompletionModelHandle<
  Controls extends CompletionModelControls = CompletionModelControls,
> = StreamingCompletionModel<unknown, Controls>;
export type GrokImageGenerationModelHandle = ImageGenerationModel<unknown>;
export type GrokSpeechGenerationModelHandle = SpeechGenerationModel<unknown>;
export type GrokTranscriptionModelHandle = TranscriptionModel<unknown>;

export class GrokClient implements ModelListingClient {
  private readonly sdk: OpenAI;
  private readonly adapter: OpenAIClient;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly httpOptions: GrokHttpOptions;

  constructor(options: GrokClientOptions) {
    const managed = options.client === undefined;

    if (managed) {
      if ("http" in options) {
        throw new TypeError("GrokClient cannot combine managed credentials with http.");
      }
    } else {
      rejectManagedOptionsWithInjectedClient("GrokClient", options, [
        "apiKey",
        "baseUrl",
        "headers",
        "fetch",
      ]);
    }

    const http = managed
      ? {
          apiKey: requireApiKey("Grok", "GrokClient", options.apiKey),
          baseUrl: options.baseUrl ?? XAI_BASE_URL,
          headers: options.headers,
          fetch: options.fetch,
        }
      : {
          apiKey: requireApiKey("Grok", "GrokClient", options.http.apiKey),
          baseUrl: options.http.baseUrl ?? XAI_BASE_URL,
          headers: options.http.headers,
          fetch: options.http.fetch,
        };
    this.sdk =
      options.client ??
      new OpenAI({
        apiKey: http.apiKey,
        baseURL: http.baseUrl,
        defaultHeaders: http.headers,
        fetch: http.fetch,
        maxRetries: 0,
      });
    this.adapter = new OpenAIClient({ client: this.sdk });
    this.fetchFn = http.fetch ?? defaultFetch();
    this.httpOptions = {
      apiKey: http.apiKey,
      baseUrl: http.baseUrl,
      headers: http.headers,
      fetch: this.fetchFn,
    };
  }

  completionModel<
    const ModelId extends GrokCompletionModelId,
    const Controls extends CompletionModelControls = GrokControlsFor<ModelId>,
  >(options: GrokCompletionModelOptions<ModelId, Controls>): GrokCompletionModelHandle<Controls> {
    const modelId = requireModelId(options.modelId);
    const controls = (
      options.controls === undefined
        ? grokControlsForModel(modelId)
        : defineCompletionModelControls(options.controls)
    ) as Controls | undefined;
    return new GrokCompletionModel(
      this.adapter,
      modelId,
      options.api,
      resolveModelContextLimits(
        modelId,
        GROK_COMPLETION_MODEL_CONTEXT_LIMITS,
        options.contextLimits,
      ),
      controls,
    );
  }

  imageGenerationModel(options: GrokImageGenerationModelOptions): GrokImageGenerationModelHandle {
    return new GrokImageGenerationModel(this.sdk, requireModelId(options.modelId), this.fetchFn);
  }

  speechGenerationModel(): GrokSpeechGenerationModelHandle {
    return new GrokSpeechGenerationModel(this.httpOptions);
  }

  transcriptionModel(): GrokTranscriptionModelHandle {
    return new GrokTranscriptionModel(this.httpOptions);
  }

  async listModels(options: { abortSignal?: AbortSignal | undefined } = {}): Promise<ModelList> {
    return listGrokModels(this.sdk, options);
  }
}

function defaultFetch(): typeof fetch | undefined {
  return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
}
