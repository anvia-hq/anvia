import type { JsonObject } from "../completion";
import { throwIfAborted } from "../internal/abort";
import type { ModelCallOptions } from "../model-call-options";
import {
  type ResolvedRetryOptions,
  type RetrySetting,
  resolveRetryOptions,
  runWithRetries,
} from "../retry";
import type { TranscriptionModel, TranscriptionRequest, TranscriptionResult } from "./types";

export type TranscriptionAudio = {
  data: Uint8Array | ArrayBuffer;
  filename: string;
  mediaType?: string | undefined;
};

export type TranscribeOptions<Model extends TranscriptionModel = TranscriptionModel> = {
  model: Model;
  audio: TranscriptionAudio;
  language?: string | undefined;
  prompt?: string | undefined;
  temperature?: number | undefined;
  providerOptions?: JsonObject | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
};

type RawResponseOf<Model> =
  Model extends TranscriptionModel<infer RawResponse> ? RawResponse : unknown;

export async function transcribe<Model extends TranscriptionModel>(
  options: TranscribeOptions<Model>,
): Promise<TranscriptionResult<RawResponseOf<Model>>> {
  const data = toUint8Array(options.audio.data);
  if (data.byteLength === 0) {
    throw new Error("Transcription audio cannot be empty.");
  }
  if (typeof options.audio.filename !== "string" || options.audio.filename.trim().length === 0) {
    throw new TypeError("Transcription filename must be a non-empty string.");
  }
  throwIfAborted(options.abortSignal);

  const request: TranscriptionRequest = { data, filename: options.audio.filename };
  if (options.audio.mediaType !== undefined) request.mediaType = options.audio.mediaType;
  if (options.language !== undefined) request.language = options.language;
  if (options.prompt !== undefined) request.prompt = options.prompt;
  if (options.temperature !== undefined) request.temperature = options.temperature;
  if (options.providerOptions !== undefined) request.providerOptions = options.providerOptions;

  return await runWithRetries(
    () => {
      throwIfAborted(options.abortSignal);
      return options.model.transcription(request, modelCallOptions(options.abortSignal)) as Promise<
        TranscriptionResult<RawResponseOf<Model>>
      >;
    },
    resolveRetries(options.retries),
    { streaming: false, abortSignal: options.abortSignal },
  );
}

function resolveRetries(setting: RetrySetting | undefined): ResolvedRetryOptions | undefined {
  return setting === undefined || setting === false ? undefined : resolveRetryOptions(setting);
}

function modelCallOptions(abortSignal: AbortSignal | undefined): ModelCallOptions | undefined {
  return abortSignal === undefined ? undefined : { abortSignal };
}

function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return new Uint8Array(bytes.slice(0));
}
