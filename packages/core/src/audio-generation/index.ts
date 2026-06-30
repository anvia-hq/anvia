import type { JsonValue } from "../completion";

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

export class AudioGenerationRequestBuilder<
  Model extends AudioGenerationModel = AudioGenerationModel,
> {
  private request: AudioGenerationRequest = {
    text: "",
    voice: "",
    speed: 1,
  };

  constructor(private readonly model: Model) {}

  text(text: string): this {
    this.request = { ...this.request, text };
    return this;
  }

  voice(voice: string): this {
    this.request = { ...this.request, voice };
    return this;
  }

  speed(speed: number): this {
    this.request = { ...this.request, speed };
    return this;
  }

  additionalParams(additionalParams: JsonValue): this {
    this.request = { ...this.request, additionalParams };
    return this;
  }

  build(): AudioGenerationRequest {
    return { ...this.request };
  }

  send(): Promise<Awaited<ReturnType<Model["audioGeneration"]>>> {
    return this.model.audioGeneration(this.build()) as Promise<
      Awaited<ReturnType<Model["audioGeneration"]>>
    >;
  }
}

export function audioGenerationRequest<Model extends AudioGenerationModel>(
  model: Model,
): AudioGenerationRequestBuilder<Model> {
  return new AudioGenerationRequestBuilder(model);
}
