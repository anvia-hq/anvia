import type { JsonValue } from "../completion";
import { type RetryOptions, resolveRetryOptions, runWithRetries } from "../retry";
import type { TranscriptionModel, TranscriptionRequest } from "./types";

export type TranscribeOptions<Model extends TranscriptionModel = TranscriptionModel> = {
  model: Model;
  filename: string;
  language?: string | undefined;
  prompt?: string | undefined;
  temperature?: number | undefined;
  additionalParams?: JsonValue | undefined;
  retries?: RetryOptions | undefined;
};

export function transcribe<Model extends TranscriptionModel>(
  audio: Uint8Array | ArrayBuffer,
  options: TranscribeOptions<Model>,
): Promise<Awaited<ReturnType<Model["transcription"]>>> {
  const data = toUint8Array(audio);
  if (data.byteLength === 0) {
    throw new Error("Transcription audio cannot be empty.");
  }
  if (typeof options.filename !== "string" || options.filename.trim().length === 0) {
    throw new TypeError("Transcription filename must be a non-empty string.");
  }

  const request: TranscriptionRequest = { data, filename: options.filename };
  if (options.language !== undefined) request.language = options.language;
  if (options.prompt !== undefined) request.prompt = options.prompt;
  if (options.temperature !== undefined) request.temperature = options.temperature;
  if (options.additionalParams !== undefined) request.additionalParams = options.additionalParams;

  const retries = options.retries === undefined ? undefined : resolveRetryOptions(options.retries);
  return runWithRetries<Awaited<ReturnType<Model["transcription"]>>>(
    () =>
      options.model.transcription(request) as Promise<Awaited<ReturnType<Model["transcription"]>>>,
    retries,
    { streaming: false },
  );
}

function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return new Uint8Array(bytes);
}
