import { Buffer } from "node:buffer";
import type { JsonObject } from "@anvia/core/completion";
import type {
  ModelCallOptions,
  SpeechGenerationModel,
  SpeechGenerationRequest,
  SpeechGenerationResult,
} from "@anvia/core/speech-generation";
import {
  type GrokHttpOptions,
  grokEndpoint,
  grokFetch,
  grokHeaders,
  throwGrokHttpError,
} from "./http";

export class GrokSpeechGenerationModel implements SpeechGenerationModel<unknown> {
  readonly provider = "grok";

  constructor(private readonly http: GrokHttpOptions) {}

  async speechGeneration(
    request: SpeechGenerationRequest,
    options?: ModelCallOptions,
  ): Promise<SpeechGenerationResult<unknown>> {
    if (request.speed !== 1) {
      throw new TypeError(
        "Grok text-to-speech does not expose speed control; use the default speed of 1.",
      );
    }
    const providerOptions = jsonObject(request.providerOptions, "speech generation");
    const body = {
      ...providerOptions,
      text: request.text,
      voice_id: request.voice,
      language: typeof providerOptions.language === "string" ? providerOptions.language : "auto",
    };
    const response = await grokFetch(this.http)(grokEndpoint(this.http, "tts"), {
      method: "POST",
      headers: grokHeaders(this.http, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      ...(options?.abortSignal === undefined ? {} : { signal: options.abortSignal }),
    });
    if (!response.ok) {
      return throwGrokHttpError(response, "text-to-speech");
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (contentType === "application/json") {
      const payload = (await response.json()) as unknown;
      return {
        audio: {
          data: audioFromJson(payload),
          mediaType: mediaTypeFromJson(payload),
        },
        rawResponse: payload,
      };
    }
    return {
      audio: {
        data: new Uint8Array(await response.arrayBuffer()),
        mediaType: contentType ?? "audio/mpeg",
      },
      rawResponse: response,
    };
  }
}

function audioFromJson(value: unknown): Uint8Array {
  if (!isObject(value)) {
    throw new Error("Grok text-to-speech JSON response contained no audio.");
  }
  const encoded = value.audio ?? value.data ?? value.b64_json;
  if (typeof encoded !== "string") {
    throw new Error("Grok text-to-speech JSON response contained no audio.");
  }
  const base64 = encoded.includes(",") ? encoded.slice(encoded.indexOf(",") + 1) : encoded;
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function mediaTypeFromJson(value: unknown): string | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const mediaType = value.media_type ?? value.mime_type;
  return typeof mediaType === "string" ? mediaType : undefined;
}

function jsonObject(value: unknown, operation: string): JsonObject {
  if (value === undefined) {
    return {};
  }
  if (!isObject(value) || Array.isArray(value)) {
    throw new TypeError(`Grok ${operation} providerOptions must be an object.`);
  }
  return value as JsonObject;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
