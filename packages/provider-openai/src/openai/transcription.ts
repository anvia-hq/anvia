import type {
  ModelCallOptions,
  TranscriptionModel,
  TranscriptionRequest,
  TranscriptionResult,
} from "@anvia/core/transcription";
import type { OpenAI } from "openai";
import { toFile } from "openai";
import { isPlainObject } from "../utils";
import type { OpenAITranscriptionModelId } from "./models";

export const WHISPER_1 = "whisper-1";
export const GPT_TRANSCRIBE = "gpt-transcribe";
export const GPT_4O_TRANSCRIBE = "gpt-4o-transcribe";
export const GPT_4O_MINI_TRANSCRIBE = "gpt-4o-mini-transcribe";
export const GPT_4O_TRANSCRIBE_DIARIZE = "gpt-4o-transcribe-diarize";

export class OpenAITranscriptionModel implements TranscriptionModel<unknown> {
  readonly provider = "openai";

  constructor(
    private readonly client: OpenAI,
    readonly modelId: OpenAITranscriptionModelId,
  ) {}

  async transcription(
    request: TranscriptionRequest,
    options?: ModelCallOptions,
  ): Promise<TranscriptionResult<unknown>> {
    const providerOptions = isPlainObject(request.providerOptions) ? request.providerOptions : {};
    const params: Record<string, unknown> = {
      ...providerOptions,
      model: this.modelId,
      file: await toFile(
        request.data,
        request.filename,
        request.mediaType === undefined ? undefined : { type: request.mediaType },
      ),
    };

    if (request.language !== undefined) params.language = request.language;
    if (request.prompt !== undefined) params.prompt = request.prompt;
    if (request.temperature !== undefined) params.temperature = request.temperature;
    const response = await this.client.audio.transcriptions.create(params as never, {
      signal: options?.abortSignal,
      maxRetries: 0,
    });
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
