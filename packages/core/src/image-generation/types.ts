import type { JsonValue } from "../completion/types";

export type ImageGenerationRequest = {
  prompt: string;
  width: number;
  height: number;
  additionalParams?: JsonValue | undefined;
};

export type GeneratedImage = {
  data: Uint8Array;
  mediaType?: string | undefined;
};

export type ImageGenerationResponse<RawResponse = unknown> = {
  image: Uint8Array;
  images: GeneratedImage[];
  mediaType?: string | undefined;
  rawResponse: RawResponse;
};

export interface ImageGenerationModel<RawResponse = unknown, ModelName extends string = string> {
  readonly provider?: string | undefined;
  readonly defaultModel?: ModelName | undefined;
  imageGeneration(request: ImageGenerationRequest): Promise<ImageGenerationResponse<RawResponse>>;
}
