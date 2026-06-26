---
title: Image generation
description: Use provider-neutral image generation model contracts and requests.
section: advanced
sidebar:
  group: Structured workflows
  order: 44
---

Image generation in core is a provider-neutral contract. A provider package implements `ImageGenerationModel`; your app builds an `ImageGenerationRequest` and receives bytes plus provider raw response data.

Use image generation in server-side routes, workers, or internal tools. Do not expose provider credentials or raw generation clients to browser code.

## Send A Request

```ts
import { writeFile } from "node:fs/promises";
import { imageGenerationRequest } from "@anvia/core/image-generation";

const request = imageGenerationRequest(imageModel)
  .prompt("A clean product illustration of a document ingestion pipeline")
  .width(1024)
  .height(1024)
  .additionalParams({ output_format: "png" });

const response = await request.send();

await writeFile("document-pipeline.png", response.image);
```

`response.image` is the first generated image as `Uint8Array`. `response.images` contains all returned images with optional media types.

`imageGenerationRequest(...)` returns an `ImageGenerationRequestBuilder`. Use the builder in application code; use the exported `ImageGenerationRequest`, `ImageGenerationResponse`, and `GeneratedImage` types when writing provider adapters or tests.

## Model Contract

Provider adapters implement this shape:

```ts
import type {
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "@anvia/core/image-generation";

class ProductImageModel implements ImageGenerationModel {
  readonly provider = "example";
  readonly defaultModel = "image-model";

  async imageGeneration(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse> {
    return imageProvider.generate(request);
  }
}
```

Application code should depend on the core contract and inject the provider model from configuration.

## Request Fields

An image generation request includes:

- `prompt`
- `width`
- `height`
- optional `additionalParams`

Use `additionalParams(...)` for provider-specific settings such as quality, format, safety options, seed, style, or model-specific config. Keep those values in typed app config when they matter to product behavior.

## Store Outputs

Generated image bytes should usually be written to object storage or a media service:

```ts
const image = await imageGenerationRequest(imageModel)
  .prompt(prompt)
  .width(1200)
  .height(800)
  .send();

const asset = await mediaStore.put({
  bytes: image.image,
  mediaType: image.mediaType ?? "image/png",
  metadata: {
    prompt,
    provider: imageModel.provider ?? "unknown",
    model: imageModel.defaultModel ?? "unknown",
  },
});
```

Store enough metadata to audit where an asset came from. Avoid logging sensitive prompts.

## Use In Pipelines

Image generation can be a pipeline step:

```ts
const creativePipeline = new PipelineBuilder(
  z.object({
    prompt: z.string(),
    width: z.number().int().positive().default(1024),
    height: z.number().int().positive().default(1024),
  }),
)
  .step(async ({ prompt, width, height }) => {
    const image = await imageGenerationRequest(imageModel)
      .prompt(prompt)
      .width(width)
      .height(height)
      .send();

    return {
      bytes: image.image,
      mediaType: image.mediaType ?? "image/png",
    };
  })
  .build();
```

Use a worker for slow or expensive generation. A route can enqueue the job and return status instead of holding the request open.

## Production Guidance

Validate prompt input before sending it to a provider. Apply product policy before generation, not after storing the asset.

Set clear output size constraints. Width and height are required in the core request builder and default to `1024` when not changed.

Provider support differs. Test the configured model id with the exact dimensions and `additionalParams` your workflow will use.
