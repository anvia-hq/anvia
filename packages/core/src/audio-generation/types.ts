import type { JsonValue } from "../completion/types";

export type AudioGenerationRequest = {
  text: string;
  voice: string;
  speed: number;
  additionalParams?: JsonValue | undefined;
};

export type AudioGenerationResponse<RawResponse = unknown> = {
  audio: Uint8Array;
  mediaType?: string | undefined;
  rawResponse: RawResponse;
};

export interface AudioGenerationModel<RawResponse = unknown, ModelName extends string = string> {
  readonly provider?: string | undefined;
  readonly defaultModel?: ModelName | undefined;
  audioGeneration(request: AudioGenerationRequest): Promise<AudioGenerationResponse<RawResponse>>;
}
