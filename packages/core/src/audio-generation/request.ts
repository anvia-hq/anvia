import type { JsonValue } from "../completion/types";
import type { AudioGenerationModel, AudioGenerationRequest } from "./types";

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
