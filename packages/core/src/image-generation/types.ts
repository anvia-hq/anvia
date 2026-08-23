import type { JsonObject } from "../completion/types";
import type { ModelCallOptions } from "../model-call-options";

export type ImageGenerationRequest = {
  prompt: string;
  width: number;
  height: number;
  providerOptions?: JsonObject | undefined;
};

export type GeneratedImage = {
  data: Uint8Array;
  mediaType?: string | undefined;
};

export type ImageGenerationResult<RawResponse = unknown> = {
  images: readonly [GeneratedImage, ...GeneratedImage[]];
  rawResponse: RawResponse;
};

export interface ImageGenerationModel<RawResponse = unknown> {
  readonly provider: string;
  readonly modelId: string | undefined;
  imageGeneration(
    request: ImageGenerationRequest,
    options?: ModelCallOptions,
  ): Promise<ImageGenerationResult<RawResponse>>;
}
