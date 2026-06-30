import { Buffer } from "node:buffer";
import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "@anvia/core/image-generation";
import type { OpenAI } from "openai";
import { GROK_IMAGINE_IMAGE } from "./constants";

export class GrokImageGenerationModel implements ImageGenerationModel {
  readonly provider = "grok";

  constructor(
    private readonly client: OpenAI,
    readonly defaultModel = GROK_IMAGINE_IMAGE,
    private readonly fetchFn: typeof fetch | undefined = defaultFetch(),
  ) {}

  async imageGeneration(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse<unknown>> {
    const params: Record<string, unknown> = {
      ...sanitizedAdditionalParams(request.additionalParams),
      model: this.defaultModel,
      prompt: request.prompt,
      n: 1,
      response_format: "b64_json",
      aspect_ratio: aspectRatio(request.width, request.height),
    };

    const response = await this.client.images.generate(params as never);
    return imageResponseFromGrok(response, this.fetchFn);
  }
}

export async function imageResponseFromGrok(
  response: unknown,
  fetchFn?: typeof fetch,
): Promise<ImageGenerationResponse<unknown>> {
  const raw = isPlainObject(response) ? response : {};
  const data = Array.isArray(raw.data) ? raw.data : [];
  const images: GeneratedImage[] = [];

  for (const item of data) {
    if (!isPlainObject(item)) {
      continue;
    }

    if (typeof item.b64_json === "string") {
      images.push({
        data: decodeBase64Image(item.b64_json),
        mediaType: imageMediaType(item, raw),
      });
      continue;
    }

    if (typeof item.url === "string") {
      images.push(await fetchGeneratedImage(item.url, fetchFn, imageMediaType(item, raw)));
    }
  }

  const image = images[0]?.data;
  if (image === undefined) {
    throw new Error("Grok image generation response contained no images.");
  }

  return {
    image,
    images,
    mediaType: images[0]?.mediaType,
    rawResponse: response,
  };
}

export function aspectRatio(width: number, height: number): string {
  const normalizedWidth = validateDimension(width, "width");
  const normalizedHeight = validateDimension(height, "height");
  const divisor = gcd(normalizedWidth, normalizedHeight);
  return `${normalizedWidth / divisor}:${normalizedHeight / divisor}`;
}

function validateDimension(value: number, name: "width" | "height"): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Grok image generation ${name} must be a finite positive number.`);
  }

  if (value <= 0) {
    throw new Error(`Grok image generation ${name} must be a positive number.`);
  }

  if (!Number.isInteger(value)) {
    throw new Error(`Grok image generation ${name} must be an integer.`);
  }

  return value;
}

async function fetchGeneratedImage(
  url: string,
  fetchFn: typeof fetch | undefined,
  fallbackMediaType: string,
): Promise<GeneratedImage> {
  if (fetchFn === undefined) {
    throw new Error(
      "Grok image generation response contained image URLs, but no fetch implementation is available.",
    );
  }

  const validatedUrl = validateGeneratedImageUrl(url);

  const response = await fetchFn(validatedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Grok image URL: ${response.status}`);
  }

  const mediaType = response.headers.get("content-type")?.split(";")[0] ?? fallbackMediaType;
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mediaType,
  };
}

function sanitizedAdditionalParams(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {};
  }

  const { model, prompt, n, response_format, aspect_ratio, ...params } = value;
  void model;
  void prompt;
  void n;
  void response_format;
  void aspect_ratio;
  return params;
}

function validateGeneratedImageUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Grok image generation response contained an invalid image URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Grok image generation image URLs must use HTTPS.");
  }

  const allowedHosts = new Set(["imgen.x.ai", "api.x.ai"]);
  if (!allowedHosts.has(parsed.hostname)) {
    throw new Error("Grok image generation image URL host is not allowed.");
  }

  return parsed.toString();
}

function imageMediaType(item: Record<string, unknown>, raw: Record<string, unknown>): string {
  const mimeType = item.mime_type ?? item.mimeType;
  if (typeof mimeType === "string" && mimeType.length > 0) {
    return mimeType;
  }

  const outputFormat = raw.output_format ?? raw.outputFormat;
  if (typeof outputFormat === "string" && outputFormat.length > 0) {
    return mediaTypeFromFormat(outputFormat);
  }

  return "image/png";
}

function decodeBase64Image(value: string): Uint8Array {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return new Uint8Array(Buffer.from(encoded, "base64"));
}

function mediaTypeFromFormat(format: string): string {
  const normalized = format.toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") {
    return "image/jpeg";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  if (normalized === "gif") {
    return "image/gif";
  }
  return "image/png";
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

function defaultFetch(): typeof fetch | undefined {
  return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
