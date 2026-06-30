import { Buffer } from "node:buffer";
import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "@anvia/core/image-generation";
import type { GoogleGenAI } from "@google/genai";
import type { GeminiImageGenerationModelName } from "./models";

export const GEMINI_2_5_FLASH_IMAGE = "gemini-2.5-flash-image";
export const GEMINI_3_PRO_IMAGE_PREVIEW = "gemini-3-pro-image-preview";
export const IMAGEN_4_GENERATE = "imagen-4.0-generate-001";

export class GeminiImageGenerationModel
  implements ImageGenerationModel<unknown, GeminiImageGenerationModelName>
{
  readonly provider = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly defaultModel: GeminiImageGenerationModelName = GEMINI_2_5_FLASH_IMAGE,
  ) {}

  async imageGeneration(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse<unknown>> {
    const params: Record<string, unknown> = {
      model: this.defaultModel,
      contents: request.prompt,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: aspectRatio(request.width, request.height) },
      },
    };

    if (isPlainObject(request.additionalParams)) {
      const { config, ...topLevel } = request.additionalParams;
      Object.assign(params, topLevel);
      if (isPlainObject(config)) {
        params.config = { ...(params.config as Record<string, unknown>), ...config };
      }
    }

    const response = await this.client.models.generateContent(params as never);
    return nativeImageResponseFromGemini(response);
  }
}

export class GeminiImagenGenerationModel
  implements ImageGenerationModel<unknown, GeminiImageGenerationModelName>
{
  readonly provider = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly defaultModel: GeminiImageGenerationModelName = IMAGEN_4_GENERATE,
  ) {}

  async imageGeneration(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse<unknown>> {
    const params: Record<string, unknown> = {
      model: this.defaultModel,
      prompt: request.prompt,
      config: { aspectRatio: aspectRatio(request.width, request.height) },
    };

    if (isPlainObject(request.additionalParams)) {
      const { config, ...topLevel } = request.additionalParams;
      Object.assign(params, topLevel);
      if (isPlainObject(config)) {
        params.config = { ...(params.config as Record<string, unknown>), ...config };
      }
    }

    const response = await this.client.models.generateImages(params as never);
    return imagenResponseFromGemini(response);
  }
}

export function nativeImageResponseFromGemini(response: unknown): ImageGenerationResponse<unknown> {
  const raw = response as Record<string, unknown>;
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const images = candidates.flatMap((candidate): GeneratedImage[] => {
    if (!isPlainObject(candidate) || !isPlainObject(candidate.content)) {
      return [];
    }
    const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    return parts.flatMap((part): GeneratedImage[] => {
      if (!isPlainObject(part) || !isPlainObject(part.inlineData)) {
        return [];
      }
      const data = part.inlineData.data;
      if (typeof data !== "string") {
        return [];
      }
      return [
        {
          data: decodeBase64Image(data),
          mediaType:
            typeof part.inlineData.mimeType === "string" ? part.inlineData.mimeType : "image/png",
        },
      ];
    });
  });

  const image = images[0]?.data;
  if (image === undefined) {
    throw new Error("Gemini image generation response contained no inline image data.");
  }

  return {
    image,
    images,
    mediaType: images[0]?.mediaType,
    rawResponse: response,
  };
}

export function imagenResponseFromGemini(response: unknown): ImageGenerationResponse<unknown> {
  const raw = response as Record<string, unknown>;
  const images = (Array.isArray(raw.generatedImages) ? raw.generatedImages : []).flatMap(
    (item): GeneratedImage[] => {
      if (!isPlainObject(item) || !isPlainObject(item.image)) {
        return [];
      }
      const imageBytes = item.image.imageBytes;
      if (typeof imageBytes !== "string") {
        return [];
      }
      return [
        {
          data: decodeBase64Image(imageBytes),
          mediaType: typeof item.image.mimeType === "string" ? item.image.mimeType : "image/png",
        },
      ];
    },
  );

  const image = images[0]?.data;
  if (image === undefined) {
    throw new Error("Gemini image generation response contained no base64 images.");
  }

  return {
    image,
    images,
    mediaType: images[0]?.mediaType,
    rawResponse: response,
  };
}

export function aspectRatio(width: number, height: number): string {
  const normalizedWidth = Math.max(1, Math.trunc(width));
  const normalizedHeight = Math.max(1, Math.trunc(height));
  const divisor = gcd(normalizedWidth, normalizedHeight);
  return `${normalizedWidth / divisor}:${normalizedHeight / divisor}`;
}

function gcd(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function decodeBase64Image(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, "").replace(/=+$/, "");
  const bytes = Buffer.from(value, "base64");
  const roundTrip = bytes.toString("base64").replace(/=+$/, "");
  if (normalized.length === 0 || bytes.length === 0 || roundTrip !== normalized) {
    throw new Error("Gemini image generation response contained invalid base64 image data.");
  }
  return new Uint8Array(bytes);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
