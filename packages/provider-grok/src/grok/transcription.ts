import type { JsonObject, JsonValue, ModelCallOptions } from "@anvia/core/completion";
import type {
  TranscriptionModel,
  TranscriptionRequest,
  TranscriptionResult,
} from "@anvia/core/transcription";
import {
  type GrokHttpOptions,
  grokEndpoint,
  grokFetch,
  grokHeaders,
  throwGrokHttpError,
} from "./http";

export class GrokTranscriptionModel implements TranscriptionModel<unknown> {
  readonly provider = "grok";
  readonly modelId = undefined;

  constructor(private readonly http: GrokHttpOptions) {}

  async transcription(
    request: TranscriptionRequest,
    options?: ModelCallOptions,
  ): Promise<TranscriptionResult<unknown>> {
    if (request.prompt !== undefined) {
      throw new TypeError("Grok batch transcription does not support prompt.");
    }
    if (request.temperature !== undefined) {
      throw new TypeError("Grok batch transcription does not support temperature.");
    }
    const form = new FormData();
    const providerOptions = jsonObject(request.providerOptions);
    for (const [name, value] of Object.entries(providerOptions)) {
      if (name === "file" || name === "language") {
        continue;
      }
      appendFormValue(form, name, value);
    }
    appendFormValue(form, "language", request.language ?? providerOptions.language);
    form.append(
      "file",
      new Blob(
        [request.data],
        request.mediaType === undefined ? undefined : { type: request.mediaType },
      ),
      request.filename,
    );

    const requestOptions: RequestInit = {
      method: "POST",
      headers: grokHeaders(this.http),
      body: form,
    };
    if (options?.abortSignal !== undefined) requestOptions.signal = options.abortSignal;
    const response = await grokFetch(this.http)(grokEndpoint(this.http, "stt"), requestOptions);
    if (!response.ok) {
      return throwGrokHttpError(response, "speech-to-text");
    }
    const payload = (await response.json()) as unknown;
    if (!isObject(payload) || typeof payload.text !== "string") {
      throw new Error("Grok speech-to-text response contained no text.");
    }
    return {
      text: payload.text,
      rawResponse: payload,
    };
  }
}

function jsonObject(value: unknown): JsonObject {
  if (value === undefined) {
    return {};
  }
  if (!isObject(value) || Array.isArray(value)) {
    throw new TypeError("Grok transcription providerOptions must be an object.");
  }
  return value as JsonObject;
}

function appendFormValue(form: FormData, name: string, value: JsonValue | undefined): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendFormValue(form, name, item);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    form.append(name, JSON.stringify(value));
    return;
  }
  form.append(name, String(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
