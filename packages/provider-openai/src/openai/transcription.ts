import type {
  TranscriptionModel,
  TranscriptionRequest,
  TranscriptionResponse,
} from "@anvia/core/transcription";
import type { OpenAI } from "openai";
import { toFile } from "openai";
import { isPlainObject } from "../utils";
import type { OpenAITranscriptionModelName } from "./models";

export const WHISPER_1 = "whisper-1";

export class OpenAITranscriptionModel
  implements TranscriptionModel<unknown, OpenAITranscriptionModelName>
{
  readonly provider = "openai";

  constructor(
    private readonly client: OpenAI,
    readonly defaultModel: OpenAITranscriptionModelName = WHISPER_1,
  ) {}

  async transcription(request: TranscriptionRequest): Promise<TranscriptionResponse<unknown>> {
    const params: Record<string, unknown> = {
      model: this.defaultModel,
      file: await toFile(request.data, request.filename),
    };

    if (request.language !== undefined) params.language = request.language;
    if (request.prompt !== undefined) params.prompt = request.prompt;
    if (request.temperature !== undefined) params.temperature = request.temperature;
    if (request.additionalParams !== undefined && isPlainObject(request.additionalParams)) {
      Object.assign(params, request.additionalParams);
    }

    const response = await this.client.audio.transcriptions.create(params as never);
    return {
      text: transcriptionText(response),
      rawResponse: response,
    };
  }
}

export function transcriptionText(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }
  if (isPlainObject(response) && typeof response.text === "string") {
    return response.text;
  }
  throw new Error("OpenAI transcription response contained no text.");
}
