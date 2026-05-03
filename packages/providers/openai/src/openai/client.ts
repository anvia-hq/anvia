import type { StreamingCompletionModel } from "@anvia/core/completion";
import OpenAI from "openai";
import { OpenAIAudioGenerationModel, TTS_1 } from "./audio-generation";
import { OpenAIChatCompletionModel } from "./chat-completion";
import { OpenAIEmbeddingModel, type ProviderEmbeddingModelOptions } from "./embedding";
import { GPT_IMAGE_1, OpenAIImageGenerationModel } from "./image-generation";
import { OpenAIResponsesCompletionModel } from "./responses";
import { OpenAITranscriptionModel, WHISPER_1 } from "./transcription";

export type OpenAIClientOptions = {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  completionApi?: "responses" | "chat" | undefined;
  client?: OpenAI | undefined;
};

export class OpenAIClient {
  readonly client: OpenAI;
  private readonly completionApi: "responses" | "chat";

  constructor(options: OpenAIClientOptions = {}) {
    this.completionApi =
      options.completionApi ?? (options.baseUrl === undefined ? "responses" : "chat");
    this.client =
      options.client ??
      new OpenAI({
        apiKey: requireApiKey(options.apiKey),
        baseURL: options.baseUrl,
        defaultHeaders: options.headers,
      });
  }

  completionModel(model = "gpt-5"): StreamingCompletionModel {
    return this.completionApi === "chat"
      ? new OpenAIChatCompletionModel(this.client, model)
      : new OpenAIResponsesCompletionModel(this.client, model);
  }

  embeddingModel(
    model = "text-embedding-3-small",
    options: ProviderEmbeddingModelOptions = {},
  ): OpenAIEmbeddingModel {
    return new OpenAIEmbeddingModel(this.client, model, options);
  }

  imageGenerationModel(model = GPT_IMAGE_1): OpenAIImageGenerationModel {
    return new OpenAIImageGenerationModel(this.client, model);
  }

  audioGenerationModel(model = TTS_1): OpenAIAudioGenerationModel {
    return new OpenAIAudioGenerationModel(this.client, model);
  }

  transcriptionModel(model = WHISPER_1): OpenAITranscriptionModel {
    return new OpenAITranscriptionModel(this.client, model);
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Missing OpenAI credentials. Pass apiKey when constructing OpenAIClient.");
  }

  return apiKey;
}
