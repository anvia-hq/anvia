import { Buffer } from "node:buffer";
import type {
  TranscriptionModel,
  TranscriptionRequest,
  TranscriptionResponse,
} from "@anvia/core/transcription";
import type { GoogleGenAI } from "@google/genai";

const TRANSCRIPTION_PREAMBLE =
  "Translate the provided audio exactly. Do not add additional information.";

export class GeminiTranscriptionModel implements TranscriptionModel {
  readonly provider = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly defaultModel = "gemini-2.5-flash",
  ) {}

  async transcription(request: TranscriptionRequest): Promise<TranscriptionResponse<unknown>> {
    const config: Record<string, unknown> = {};
    if (request.temperature !== undefined) {
      config.temperature = request.temperature;
    }
    if (isPlainObject(request.additionalParams)) {
      Object.assign(config, request.additionalParams);
    }

    const response = await this.client.models.generateContent({
      model: this.defaultModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mimeTypeFromFilename(request.filename),
                data: Buffer.from(request.data).toString("base64"),
              },
            },
          ],
        },
      ],
      config: {
        ...config,
        systemInstruction:
          request.prompt === undefined
            ? TRANSCRIPTION_PREAMBLE
            : `${TRANSCRIPTION_PREAMBLE}\n\n${request.prompt}`,
      },
    } as never);

    return {
      text: textFromGenerateContentResponse(response),
      rawResponse: response,
    };
  }
}

export function textFromGenerateContentResponse(response: unknown): string {
  const raw = response as Record<string, unknown>;
  if (typeof raw.text === "string") {
    return raw.text;
  }
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  for (const candidate of candidates) {
    if (!isPlainObject(candidate) || !isPlainObject(candidate.content)) {
      continue;
    }
    const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (isPlainObject(part) && typeof part.text === "string") {
        return part.text;
      }
    }
  }
  throw new Error("Gemini transcription response contained no text.");
}

function mimeTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".m4a")) return "audio/m4a";
  if (lower.endsWith(".opus")) return "audio/opus";
  return "audio/mpeg";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
