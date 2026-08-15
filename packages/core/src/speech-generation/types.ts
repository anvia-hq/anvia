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

export interface SpeechGenerationModel<RawResponse = unknown, ModelName extends string = string> {
  readonly provider?: string | undefined;
  readonly defaultModel?: ModelName | undefined;
  speechGeneration(
    request: SpeechGenerationRequest,
    options?: ModelCallOptions,
  ): Promise<SpeechGenerationResult<RawResponse>>;
}
