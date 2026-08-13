import type { JsonValue } from "../completion/types";
import { type RetryOptions, resolveRetryOptions, runWithRetries } from "../retry";
import type { ImageGenerationModel, ImageGenerationRequest } from "./types";

export type GenerateImageOptions<Model extends ImageGenerationModel = ImageGenerationModel> = {
  model: Model;
  width?: number | undefined;
  height?: number | undefined;
  additionalParams?: JsonValue | undefined;
  retries?: RetryOptions | undefined;
};

export function generateImage<Model extends ImageGenerationModel>(
  prompt: string,
  options: GenerateImageOptions<Model>,
): Promise<Awaited<ReturnType<Model["imageGeneration"]>>> {
  assertNonEmptyString(prompt, "Image prompt");
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  assertPositiveInteger(width, "Image width");
  assertPositiveInteger(height, "Image height");

  const request: ImageGenerationRequest = { prompt, width, height };
  if (options.additionalParams !== undefined) {
    request.additionalParams = options.additionalParams;
  }
  const retries = options.retries === undefined ? undefined : resolveRetryOptions(options.retries);
  return runWithRetries<Awaited<ReturnType<Model["imageGeneration"]>>>(
    () =>
      options.model.imageGeneration(request) as Promise<
        Awaited<ReturnType<Model["imageGeneration"]>>
      >,
    retries,
    { streaming: false },
  );
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
