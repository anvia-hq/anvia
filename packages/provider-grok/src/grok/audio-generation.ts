import { Buffer } from "node:buffer";
import type {
  AudioGenerationModel,
  AudioGenerationRequest,
  AudioGenerationResponse,
} from "@anvia/core/audio-generation";
import type { JsonObject } from "@anvia/core/completion";
import {
  type GrokHttpOptions,
  grokEndpoint,
  grokFetch,
  grokHeaders,
  throwGrokHttpError,
} from "./http";

export class GrokAudioGenerationModel implements AudioGenerationModel<unknown> {
  readonly provider = "grok";

  constructor(private readonly http: GrokHttpOptions) {}

  async audioGeneration(
    request: AudioGenerationRequest,
  ): Promise<AudioGenerationResponse<unknown>> {
    if (request.speed !== 1) {
      throw new TypeError(
        "Grok text-to-speech does not expose speed control; use the default speed of 1.",
      );
    }
    const additional = jsonObject(request.additionalParams, "audio generation");
    const body = {
      ...additional,
      text: request.text,
      voice_id: request.voice,
      language: typeof additional.language === "string" ? additional.language : "auto",
    };
    const response = await grokFetch(this.http)(grokEndpoint(this.http, "tts"), {
      method: "POST",
      headers: grokHeaders(this.http, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return throwGrokHttpError(response, "text-to-speech");
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (contentType === "application/json") {
      const payload = (await response.json()) as unknown;
      return {
        audio: audioFromJson(payload),
        mediaType: mediaTypeFromJson(payload),
        rawResponse: payload,
      };
    }
    return {
      audio: new Uint8Array(await response.arrayBuffer()),
      mediaType: contentType ?? "audio/mpeg",
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
    throw new TypeError(`Grok ${operation} additionalParams must be an object.`);
  }
  return value as JsonObject;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
