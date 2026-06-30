import type {
  AudioGenerationModel,
  AudioGenerationRequest,
  AudioGenerationResponse,
} from "@anvia/core/audio-generation";
import type { OpenAI } from "openai";
import { isPlainObject } from "../utils";
import type { OpenAIAudioGenerationModelName } from "./models";

export const TTS_1 = "tts-1";
export const TTS_1_HD = "tts-1-hd";

export class OpenAIAudioGenerationModel
  implements AudioGenerationModel<unknown, OpenAIAudioGenerationModelName>
{
  readonly provider = "openai";

  constructor(
    private readonly client: OpenAI,
    readonly defaultModel: OpenAIAudioGenerationModelName = TTS_1,
  ) {}

  async audioGeneration(
    request: AudioGenerationRequest,
  ): Promise<AudioGenerationResponse<unknown>> {
    const params: Record<string, unknown> = {
      model: this.defaultModel,
      input: request.text,
      voice: request.voice,
      speed: request.speed,
    };

    if (request.additionalParams !== undefined && isPlainObject(request.additionalParams)) {
      Object.assign(params, request.additionalParams);
    }

    const response = await this.client.audio.speech.create(params as never);
    return {
      audio: new Uint8Array(await response.arrayBuffer()),
      mediaType: mediaTypeFromFormat(params.response_format),
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
