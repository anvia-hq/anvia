import { GoogleGenAI } from "@google/genai";
import { GeminiCompletionModel } from "./completion";
import { GeminiEmbeddingModel, type GeminiEmbeddingModelOptions } from "./embedding";
import {
  GEMINI_2_5_FLASH_IMAGE,
  GeminiImageGenerationModel,
  GeminiImagenGenerationModel,
  IMAGEN_4_GENERATE,
} from "./image-generation";
import { GeminiTranscriptionModel } from "./transcription";

type GeminiApiClientOptions = {
  apiKey?: string | undefined;
  vertexai?: false | undefined;
  project?: never;
  location?: never;
};

type VertexClientOptions = {
  vertexai: true;
  project?: string | undefined;
  location?: string | undefined;
  apiKey?: never;
};

export type GeminiClientOptions = (GeminiApiClientOptions | VertexClientOptions) & {
  client?: GoogleGenAI | undefined;
};

export class GeminiClient {
  readonly client: GoogleGenAI;

  constructor(options: GeminiClientOptions = {}) {
    this.client = options.client ?? new GoogleGenAI(toGoogleGenAIOptions(options));
  }

  completionModel(model = "gemini-2.5-flash"): GeminiCompletionModel {
    return new GeminiCompletionModel(this.client, model);
  }

  embeddingModel(
    model = "gemini-embedding-001",
    options: GeminiEmbeddingModelOptions = {},
  ): GeminiEmbeddingModel {
    return new GeminiEmbeddingModel(this.client, model, options);
  }

  imageGenerationModel(model = GEMINI_2_5_FLASH_IMAGE): GeminiImageGenerationModel {
    return new GeminiImageGenerationModel(this.client, model);
  }

  imagenGenerationModel(model = IMAGEN_4_GENERATE): GeminiImagenGenerationModel {
    return new GeminiImagenGenerationModel(this.client, model);
  }

  transcriptionModel(model = "gemini-2.5-flash"): GeminiTranscriptionModel {
    return new GeminiTranscriptionModel(this.client, model);
  }
}

export function toGoogleGenAIOptions(options: GeminiClientOptions): Record<string, unknown> {
  if (options.vertexai === true) {
    return {
      vertexai: true,
      project: requireOption(options.project, "project", "Vertex Gemini"),
      location: requireOption(options.location, "location", "Vertex Gemini"),
    };
  }

  return {
    apiKey: requireOption(options.apiKey, "apiKey", "Gemini"),
  };
}

function requireOption(value: string | undefined, name: string, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${label} ${name}. Pass ${name} when constructing GeminiClient.`);
  }

  return value;
}
