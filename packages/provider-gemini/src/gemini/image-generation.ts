import { Buffer } from "node:buffer";
import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResult,
  ModelCallOptions,
} from "@anvia/core/image-generation";
import type { GoogleGenAI } from "@google/genai";
import type { GeminiGenerateContentImageModelId, GeminiGenerateImagesModelId } from "./models";
import { disableGeminiNativeRetries } from "./retry";

export const GEMINI_2_5_FLASH_IMAGE = "gemini-2.5-flash-image";
export const GEMINI_3_1_FLASH_IMAGE = "gemini-3.1-flash-image";
export const GEMINI_3_1_FLASH_LITE_IMAGE = "gemini-3.1-flash-lite-image";
export const GEMINI_3_PRO_IMAGE = "gemini-3-pro-image";
export const GEMINI_3_PRO_IMAGE_PREVIEW = "gemini-3-pro-image-preview";
export const IMAGEN_4_GENERATE = "imagen-4.0-generate-001";

export class GeminiImageGenerationModel implements ImageGenerationModel<unknown> {
  readonly provider = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly modelId: GeminiGenerateContentImageModelId,
  ) {}

  async imageGeneration(
    request: ImageGenerationRequest,
    options?: ModelCallOptions,
  ): Promise<ImageGenerationResult<unknown>> {
    const providerOptions = isPlainObject(request.providerOptions) ? request.providerOptions : {};
    const { config: providerConfigValue, ...providerTopLevel } = providerOptions;
    const providerConfig = isPlainObject(providerConfigValue) ? providerConfigValue : {};
    const providerImageConfig = isPlainObject(providerConfig.imageConfig)
      ? providerConfig.imageConfig
      : {};
    const config: Record<string, unknown> = {
      ...providerConfig,
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        ...providerImageConfig,
        aspectRatio: aspectRatio(request.width, request.height),
      },
    };
    if (options?.abortSignal !== undefined) config.abortSignal = options.abortSignal;
    const params: Record<string, unknown> = {
      ...providerTopLevel,
      model: this.modelId,
      contents: request.prompt,
      config: disableGeminiNativeRetries(config),
    };

    const response = await this.client.models.generateContent(params as never);
    return nativeImageResponseFromGemini(response);
  }
}

export class GeminiImagenGenerationModel implements ImageGenerationModel<unknown> {
  readonly provider = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly modelId: GeminiGenerateImagesModelId,
  ) {}

  async imageGeneration(
    request: ImageGenerationRequest,
    options?: ModelCallOptions,
  ): Promise<ImageGenerationResult<unknown>> {
    const providerOptions = isPlainObject(request.providerOptions) ? request.providerOptions : {};
    const { config: providerConfigValue, ...providerTopLevel } = providerOptions;
    const providerConfig = isPlainObject(providerConfigValue) ? providerConfigValue : {};
    const config: Record<string, unknown> = {
      ...providerConfig,
      aspectRatio: aspectRatio(request.width, request.height),
    };
    if (options?.abortSignal !== undefined) config.abortSignal = options.abortSignal;
    const params: Record<string, unknown> = {
      ...providerTopLevel,
      model: this.modelId,
      prompt: request.prompt,
      config: disableGeminiNativeRetries(config),
    };

    const response = await this.client.models.generateImages(params as never);
    return imagenResponseFromGemini(response);
  }
}

export function nativeImageResponseFromGemini(response: unknown): ImageGenerationResult<unknown> {
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

  if (images.length === 0) {
    throw new Error("Gemini image generation response contained no inline image data.");
  }

  return {
    images: images as [GeneratedImage, ...GeneratedImage[]],
    rawResponse: response,
  };
}

export function imagenResponseFromGemini(response: unknown): ImageGenerationResult<unknown> {
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

  if (images.length === 0) {
    throw new Error("Gemini image generation response contained no base64 images.");
  }

  return {
    images: images as [GeneratedImage, ...GeneratedImage[]],
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
