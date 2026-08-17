import { Buffer } from "node:buffer";
import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResult,
  ModelCallOptions,
} from "@anvia/core/image-generation";
import type { OpenAI } from "openai";
import { isPlainObject } from "../utils";
import type { OpenAIImageGenerationModelId } from "./models";

export const DALL_E_2 = "dall-e-2";
export const DALL_E_3 = "dall-e-3";
export const GPT_IMAGE_1 = "gpt-image-1";
export const GPT_IMAGE_2 = "gpt-image-2";

export class OpenAIImageGenerationModel implements ImageGenerationModel<unknown> {
  readonly provider = "openai";

  constructor(
    private readonly client: OpenAI,
    readonly modelId: OpenAIImageGenerationModelId,
  ) {}

  async imageGeneration(
    request: ImageGenerationRequest,
    options?: ModelCallOptions,
  ): Promise<ImageGenerationResult<unknown>> {
    const providerOptions = isPlainObject(request.providerOptions) ? request.providerOptions : {};
    const params: Record<string, unknown> = {
      ...providerOptions,
      model: this.modelId,
      prompt: request.prompt,
      size: `${request.width}x${request.height}`,
    };

    if (this.modelId === DALL_E_2 || this.modelId === DALL_E_3) {
      params.response_format = "b64_json";
    }

    const response = await this.client.images.generate(params as never, {
      signal: options?.abortSignal,
      maxRetries: 0,
    });
    return imageResponseFromOpenAI(response);
  }
}

export function imageResponseFromOpenAI(response: unknown): ImageGenerationResult<unknown> {
  const raw = response as Record<string, unknown>;
  const mediaType = mediaTypeFromFormat(
    typeof raw.output_format === "string" ? raw.output_format : "png",
  );
  const data = Array.isArray(raw.data) ? raw.data : [];
  const images = data.flatMap((item): GeneratedImage[] => {
    if (!isPlainObject(item) || typeof item.b64_json !== "string") {
      return [];
    }
    return [{ data: new Uint8Array(Buffer.from(item.b64_json, "base64")), mediaType }];
  });

  if (images.length === 0) {
    if (data.some((item) => isPlainObject(item) && typeof item.url === "string")) {
      throw new Error(
        "OpenAI image generation response contained image URLs, which are not supported.",
      );
    }
    throw new Error("OpenAI image generation response contained no base64 images.");
  }

  return {
    images: images as [GeneratedImage, ...GeneratedImage[]],
    rawResponse: response,
  };
}

function mediaTypeFromFormat(format: string): string {
  if (format === "jpeg" || format === "jpg") {
    return "image/jpeg";
  }
  if (format === "webp") {
    return "image/webp";
  }
  return "image/png";
}
