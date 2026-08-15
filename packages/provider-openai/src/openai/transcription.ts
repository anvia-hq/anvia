import type {
  ModelCallOptions,
  TranscriptionModel,
  TranscriptionRequest,
  TranscriptionResult,
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

  async transcription(
    request: TranscriptionRequest,
    options?: ModelCallOptions,
  ): Promise<TranscriptionResult<unknown>> {
    const params: Record<string, unknown> = {
      ...(isPlainObject(request.providerOptions) ? request.providerOptions : {}),
      model: this.defaultModel,
      file: await toFile(
        request.data,
        request.filename,
        request.mediaType === undefined ? undefined : { type: request.mediaType },
      ),
    };

    if (request.language !== undefined) params.language = request.language;
    if (request.prompt !== undefined) params.prompt = request.prompt;
    if (request.temperature !== undefined) params.temperature = request.temperature;
    const response = await this.client.audio.transcriptions.create(
      params as never,
      options?.abortSignal === undefined ? undefined : { signal: options.abortSignal },
    );
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
