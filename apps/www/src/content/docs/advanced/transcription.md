---
title: Transcription
description: Use provider-neutral transcription model contracts and requests.
section: advanced
sidebar:
  group: Structured workflows
  order: 46
---

Transcription converts audio bytes into text through a provider-neutral model contract. Core owns the request builder and types; provider packages own the API integration.

Use transcription in server routes, workers, upload processors, call review tools, meeting note workflows, and media pipelines.

## Send A Request

```ts
import { readFile } from "node:fs/promises";
import { transcriptionRequest } from "@anvia/core/transcription";

const audio = await readFile("support-call.wav");

const request = transcriptionRequest(transcriptionModel)
  .data(audio)
  .filename("support-call.wav")
  .language("en")
  .prompt("Transcribe the customer support call exactly.")
  .temperature(0);

const transcript = await request.send();

console.log(transcript.text);
```

`data(...)` accepts `Uint8Array` or `ArrayBuffer`. `build()` throws if the audio data is empty.

`transcriptionRequest(...)` returns a `TranscriptionRequestBuilder`. Use the builder in application code; use the exported `TranscriptionRequest` and `TranscriptionResponse` types when writing provider adapters or tests.

## Model Contract

```ts
import type {
  TranscriptionModel,
  TranscriptionRequest,
  TranscriptionResponse,
} from "@anvia/core/transcription";

class ProductTranscriptionModel implements TranscriptionModel {
  readonly provider = "example";
  readonly defaultModel = "transcription-model";

  async transcription(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResponse> {
    return speechProvider.transcribe(request);
  }
}
```

Inject the model into runners or workers. Keep provider credentials and uploaded audio handling outside browser code.

## Request Fields

A transcription request includes:

- `data`
- `filename`
- optional `language`
- optional `prompt`
- optional `temperature`
- optional `additionalParams`

Set `filename(...)` to a useful name with an extension when the provider uses it to infer media type. Use `language(...)` when known; it can improve accuracy and reduce provider ambiguity.

Use `prompt(...)` for transcription guidance, not unrelated instructions. Good prompts include domain vocabulary, speaker context, or formatting expectations.

## Use With Extractors

Transcription often feeds structured extraction:

```ts
const transcript = await transcriptionRequest(transcriptionModel)
  .data(audioBytes)
  .filename(upload.filename)
  .language("en")
  .temperature(0)
  .send();

const callSummary = await callExtractor.extract(transcript.text);
```

Keep the stages separate so each failure can be handled clearly: upload validation, transcription, extraction, and product write.

## Use In A Pipeline

```ts
const AudioInput = z.object({
  filename: z.string(),
  bytes: z.instanceof(Uint8Array),
});

const callPipeline = new PipelineBuilder(AudioInput)
  .step(async ({ filename, bytes }) => {
    const transcript = await transcriptionRequest(transcriptionModel)
      .data(bytes)
      .filename(filename)
      .prompt("Return a clean transcript.")
      .temperature(0)
      .send();

    return transcript.text;
  })
  .extract(callExtractor)
  .build();
```

For large audio files, run this in a worker and store intermediate transcript text for debugging and review.

## Production Guidance

Validate file size, media type, and user permissions before reading bytes into memory. Store original audio according to your product retention policy.

Do not put raw audio bytes into agent memory, traces, or event logs. Store an asset id and keep the bytes in media storage.

Transcription can contain sensitive personal data. Apply redaction or access controls before sending transcripts into downstream agents, retrieval indexes, or customer-visible summaries.
