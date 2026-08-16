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

export interface TranscriptionModel<RawResponse = unknown> {
  readonly provider: string;
  readonly modelId: string | undefined;
  transcription(
    request: TranscriptionRequest,
    options?: ModelCallOptions,
  ): Promise<TranscriptionResult<RawResponse>>;
}
