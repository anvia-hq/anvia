import type { JsonValue } from "../completion";

export type TranscriptionRequest = {
  data: Uint8Array;
  filename: string;
  language?: string | undefined;
  prompt?: string | undefined;
  temperature?: number | undefined;
  additionalParams?: JsonValue | undefined;
};

export type TranscriptionResponse<RawResponse = unknown> = {
  text: string;
  rawResponse: RawResponse;
};

export interface TranscriptionModel<RawResponse = unknown, ModelName extends string = string> {
  readonly provider?: string | undefined;
  readonly defaultModel?: ModelName | undefined;
  transcription(request: TranscriptionRequest): Promise<TranscriptionResponse<RawResponse>>;
}
