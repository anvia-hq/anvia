import type { JsonObject, JsonValue } from "@anvia/core/completion";
import type {
  TranscriptionModel,
  TranscriptionRequest,
  TranscriptionResponse,
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

  constructor(private readonly http: GrokHttpOptions) {}

  async transcription(request: TranscriptionRequest): Promise<TranscriptionResponse<unknown>> {
    if (request.prompt !== undefined) {
      throw new TypeError("Grok batch transcription does not support prompt.");
    }
    if (request.temperature !== undefined) {
      throw new TypeError("Grok batch transcription does not support temperature.");
    }
    const form = new FormData();
    const additional = jsonObject(request.additionalParams);
    for (const [name, value] of Object.entries(additional)) {
      if (name === "file") {
        continue;
      }
      appendFormValue(form, name, value);
    }
    if (request.language !== undefined && additional.language === undefined) {
      form.append("language", request.language);
    }
    form.append("file", new Blob([request.data]), request.filename);

    const response = await grokFetch(this.http)(grokEndpoint(this.http, "stt"), {
      method: "POST",
      headers: grokHeaders(this.http),
      body: form,
    });
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
    throw new TypeError("Grok transcription additionalParams must be an object.");
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
