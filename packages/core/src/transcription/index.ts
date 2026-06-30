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

export class TranscriptionRequestBuilder<Model extends TranscriptionModel = TranscriptionModel> {
  private request: TranscriptionRequest = {
    data: new Uint8Array(),
    filename: "file",
  };

  constructor(private readonly model: Model) {}

  data(data: Uint8Array | ArrayBuffer): this {
    this.request = { ...this.request, data: toUint8Array(data) };
    return this;
  }

  filename(filename: string): this {
    this.request = { ...this.request, filename };
    return this;
  }

  language(language: string): this {
    this.request = { ...this.request, language };
    return this;
  }

  prompt(prompt: string): this {
    this.request = { ...this.request, prompt };
    return this;
  }

  temperature(temperature: number): this {
    this.request = { ...this.request, temperature };
    return this;
  }

  additionalParams(additionalParams: JsonValue): this {
    this.request = { ...this.request, additionalParams };
    return this;
  }

  build(): TranscriptionRequest {
    if (this.request.data.byteLength === 0) {
      throw new Error("Transcription data cannot be empty.");
    }
    return { ...this.request, data: toUint8Array(this.request.data) };
  }

  send(): Promise<Awaited<ReturnType<Model["transcription"]>>> {
    return this.model.transcription(this.build()) as Promise<
      Awaited<ReturnType<Model["transcription"]>>
    >;
  }
}

export function transcriptionRequest<Model extends TranscriptionModel>(
  model: Model,
): TranscriptionRequestBuilder<Model> {
  return new TranscriptionRequestBuilder(model);
}

function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return new Uint8Array(bytes);
}
