import { Buffer } from "node:buffer";
import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "@anvia/core/image-generation";
import type { GoogleGenAI } from "@google/genai";

export const GEMINI_2_5_FLASH_IMAGE = "gemini-2.5-flash-image";
export const GEMINI_3_PRO_IMAGE_PREVIEW = "gemini-3-pro-image-preview";
export const IMAGEN_4_GENERATE = "imagen-4.0-generate-001";

export class GeminiImageGenerationModel implements ImageGenerationModel {
  readonly provider = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly defaultModel = GEMINI_2_5_FLASH_IMAGE,
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

export class GeminiImagenGenerationModel implements ImageGenerationModel {
  readonly provider = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly defaultModel = IMAGEN_4_GENERATE,
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
          data: new Uint8Array(Buffer.from(data, "base64")),
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
          data: new Uint8Array(Buffer.from(imageBytes, "base64")),
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
