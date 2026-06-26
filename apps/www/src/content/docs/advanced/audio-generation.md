---
title: Audio generation
description: Use provider-neutral audio generation model contracts and requests.
section: advanced
sidebar:
  group: Structured workflows
  order: 45
---

Audio generation turns text into audio bytes through a provider-neutral model contract. Core defines the request builder and types; provider packages implement the model.

Use this for narration, accessibility, agent voice responses, media workflows, and generated previews. Keep generation server-side or worker-side.

## Send A Request

```ts
import { writeFile } from "node:fs/promises";
import { audioGenerationRequest } from "@anvia/core/audio-generation";

const request = audioGenerationRequest(audioModel)
  .text("Your incident summary is ready.")
  .voice("alloy")
  .speed(1)
  .additionalParams({ response_format: "mp3" });

const response = await request.send();

await writeFile("incident-summary.mp3", response.audio);
```

The response includes audio bytes, optional media type, and the provider raw response.

`audioGenerationRequest(...)` returns an `AudioGenerationRequestBuilder`. Use the builder in application code; use the exported `AudioGenerationRequest` and `AudioGenerationResponse` types when writing provider adapters or tests.

## Model Contract

```ts
import type {
  AudioGenerationModel,
  AudioGenerationRequest,
  AudioGenerationResponse,
} from "@anvia/core/audio-generation";

class ProductAudioModel implements AudioGenerationModel {
  readonly provider = "example";
  readonly defaultModel = "tts-model";

  async audioGeneration(
    request: AudioGenerationRequest,
  ): Promise<AudioGenerationResponse> {
    return speechProvider.generate(request);
  }
}
```

Application code should receive an `AudioGenerationModel` from config or dependency injection. Do not create provider clients inside prompt text or UI components.

## Request Fields

An audio generation request includes:

- `text`
- `voice`
- `speed`
- optional `additionalParams`

`speed` defaults to `1`. `voice` defaults to an empty string, so production code should set an explicit voice from validated configuration.

Use `additionalParams(...)` for provider-specific format, quality, voice settings, or synthesis options.

## Validate Text

Text-to-speech workflows should validate the text before generation:

```ts
const SpeechInput = z.object({
  text: z.string().min(1).max(3000),
  voice: z.enum(["alloy", "verse", "aria"]),
});

const speechPipeline = new PipelineBuilder(SpeechInput)
  .step(async ({ text, voice }) => {
    const speech = await audioGenerationRequest(audioModel)
      .text(text)
      .voice(voice)
      .speed(1)
      .additionalParams({ response_format: "mp3" })
      .send();

    return {
      audio: speech.audio,
      mediaType: speech.mediaType ?? "audio/mpeg",
    };
  })
  .build();
```

Do not send unbounded model output directly into speech generation. Add length limits and product policy checks first.

## Store And Serve Audio

Generated audio should usually be persisted to object storage:

```ts
const speech = await audioGenerationRequest(audioModel)
  .text(script)
  .voice(config.defaultVoice)
  .speed(1)
  .send();

const asset = await mediaStore.put({
  bytes: speech.audio,
  mediaType: speech.mediaType ?? "audio/mpeg",
  metadata: {
    voice: config.defaultVoice,
    model: audioModel.defaultModel ?? "unknown",
  },
});
```

Return an asset id or signed URL to the product UI. Avoid putting large audio byte arrays into session memory or event logs.

## Production Guidance

Audio generation can be slow and expensive. Use a queue for long scripts, bulk generation, or user-facing products that need retry and progress status.

Test exact voices and formats per provider. A configured model may accept the core request shape but still reject a provider-specific `additionalParams` value.
