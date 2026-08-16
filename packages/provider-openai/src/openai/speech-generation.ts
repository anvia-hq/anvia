import type {
  ModelCallOptions,
  SpeechGenerationModel,
  SpeechGenerationRequest,
  SpeechGenerationResult,
} from "@anvia/core/speech-generation";
import type { OpenAI } from "openai";
import { isPlainObject } from "../utils";
import type { OpenAISpeechGenerationModelId } from "./models";

export const TTS_1 = "tts-1";
export const TTS_1_HD = "tts-1-hd";

export class OpenAISpeechGenerationModel implements SpeechGenerationModel<unknown> {
  readonly provider = "openai";

  constructor(
    private readonly client: OpenAI,
    readonly modelId: OpenAISpeechGenerationModelId,
  ) {}

  async speechGeneration(
    request: SpeechGenerationRequest,
    options?: ModelCallOptions,
  ): Promise<SpeechGenerationResult<unknown>> {
    const params: Record<string, unknown> = {
      ...(isPlainObject(request.providerOptions) ? request.providerOptions : {}),
      model: this.modelId,
      input: request.text,
      voice: request.voice,
      speed: request.speed,
    };

    const response = await this.client.audio.speech.create(params as never, {
      signal: options?.abortSignal,
      maxRetries: 0,
    });
    return {
      audio: {
        data: new Uint8Array(await response.arrayBuffer()),
        mediaType: mediaTypeFromFormat(params.response_format),
      },
      rawResponse: response,
    };
  }
}

function mediaTypeFromFormat(format: unknown): string {
  if (format === "wav") return "audio/wav";
  if (format === "flac") return "audio/flac";
  if (format === "opus") return "audio/opus";
  if (format === "aac") return "audio/aac";
  if (format === "pcm") return "audio/pcm";
  return "audio/mpeg";
}
