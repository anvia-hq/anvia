import type { JsonObject } from "../completion";
import type { ModelCallOptions } from "../model-call-options";

export type TranscriptionRequest = {
  data: Uint8Array;
  filename: string;
  mediaType?: string | undefined;
  language?: string | undefined;
  prompt?: string | undefined;
  temperature?: number | undefined;
  providerOptions?: JsonObject | undefined;
};

export type TranscriptionResult<RawResponse = unknown> = {
  text: string;
  rawResponse: RawResponse;
};

export interface TranscriptionModel<RawResponse = unknown, ModelName extends string = string> {
  readonly provider?: string | undefined;
  readonly defaultModel?: ModelName | undefined;
  transcription(
    request: TranscriptionRequest,
    options?: ModelCallOptions,
  ): Promise<TranscriptionResult<RawResponse>>;
}
