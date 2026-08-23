import type { JsonObject } from "../completion/types";
import type { ModelCallOptions } from "../model-call-options";

export type SpeechGenerationRequest = {
  text: string;
  voice: string;
  speed: number;
  providerOptions?: JsonObject | undefined;
};

export type SpeechGenerationResult<RawResponse = unknown> = {
  audio: {
    data: Uint8Array;
    mediaType?: string | undefined;
  };
  rawResponse: RawResponse;
};

export interface SpeechGenerationModel<RawResponse = unknown> {
  readonly provider: string;
  readonly modelId: string | undefined;
  speechGeneration(
    request: SpeechGenerationRequest,
    options?: ModelCallOptions,
  ): Promise<SpeechGenerationResult<RawResponse>>;
}
