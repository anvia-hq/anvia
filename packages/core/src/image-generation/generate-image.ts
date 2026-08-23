import type { JsonObject } from "../completion/types";
import { throwIfAborted } from "../internal/abort";
import { assertJsonObject } from "../internal/json-object";
import type { ModelCallOptions } from "../model-call-options";
import {
  type ResolvedRetryOptions,
  type RetrySetting,
  resolveRetryOptions,
  runWithRetries,
} from "../retry";
import type { ImageGenerationModel, ImageGenerationRequest, ImageGenerationResult } from "./types";

export type GenerateImageOptions<Model extends ImageGenerationModel = ImageGenerationModel> = {
  model: Model;
  prompt: string;
  width?: number | undefined;
  height?: number | undefined;
  providerOptions?: JsonObject | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
};

type RawResponseOf<Model> =
  Model extends ImageGenerationModel<infer RawResponse> ? RawResponse : unknown;

export async function generateImage<Model extends ImageGenerationModel>(
  options: GenerateImageOptions<Model>,
): Promise<ImageGenerationResult<RawResponseOf<Model>>> {
  assertNonEmptyString(options.prompt, "Image prompt");
  throwIfAborted(options.abortSignal);
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  assertPositiveInteger(width, "Image width");
  assertPositiveInteger(height, "Image height");

  const request: ImageGenerationRequest = { prompt: options.prompt, width, height };
  if (options.providerOptions !== undefined) {
    assertJsonObject(options.providerOptions, "providerOptions");
    request.providerOptions = options.providerOptions;
  }
  const result = await runWithRetries(
    () => {
      throwIfAborted(options.abortSignal);
      return options.model.imageGeneration(
        request,
        modelCallOptions(options.abortSignal),
      ) as Promise<ImageGenerationResult<RawResponseOf<Model>>>;
    },
    resolveRetries(options.retries),
    { streaming: false, abortSignal: options.abortSignal },
  );
  if (!Array.isArray(result.images) || result.images.length === 0) {
    throw new Error("The image generation model returned no images.");
  }
  return result;
}

function resolveRetries(setting: RetrySetting | undefined): ResolvedRetryOptions | undefined {
  return setting === undefined || setting === false ? undefined : resolveRetryOptions(setting);
}

function modelCallOptions(abortSignal: AbortSignal | undefined): ModelCallOptions | undefined {
  return abortSignal === undefined ? undefined : { abortSignal };
}

function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}
