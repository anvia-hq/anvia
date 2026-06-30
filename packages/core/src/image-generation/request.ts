import type { JsonValue } from "../completion/types";
import type { ImageGenerationModel, ImageGenerationRequest } from "./types";

export class ImageGenerationRequestBuilder<
  Model extends ImageGenerationModel = ImageGenerationModel,
> {
  private request: ImageGenerationRequest = {
    prompt: "",
    width: 1024,
    height: 1024,
  };

  constructor(private readonly model: Model) {}

  prompt(prompt: string): this {
    this.request = { ...this.request, prompt };
    return this;
  }

  width(width: number): this {
    this.request = { ...this.request, width };
    return this;
  }

  height(height: number): this {
    this.request = { ...this.request, height };
    return this;
  }

  additionalParams(additionalParams: JsonValue): this {
    this.request = { ...this.request, additionalParams };
    return this;
  }

  build(): ImageGenerationRequest {
    return { ...this.request };
  }

  send(): Promise<Awaited<ReturnType<Model["imageGeneration"]>>> {
    return this.model.imageGeneration(this.build()) as Promise<
      Awaited<ReturnType<Model["imageGeneration"]>>
    >;
  }
}

export function imageGenerationRequest<Model extends ImageGenerationModel>(
  model: Model,
): ImageGenerationRequestBuilder<Model> {
  return new ImageGenerationRequestBuilder(model);
}
