import { describe, expect, it } from "vitest";
import { generateImage, type ImageGenerationModel } from "../src/image-generation";
import { generateSpeech, type SpeechGenerationModel } from "../src/speech-generation";
import { type TranscriptionModel, transcribe } from "../src/transcription";

describe("direct multimodal model APIs", () => {
  it("generates images with explicit options", async () => {
    const calls: unknown[] = [];
    const model: ImageGenerationModel = {
      provider: "test",
      modelId: "test-image",
      async imageGeneration(request) {
        calls.push(request);
        const image = new Uint8Array([1, 2, 3]);
        return {
          images: [{ data: image, mediaType: "image/png" }] as const,
          rawResponse: { ok: true },
        };
      },
    };

    const response = await generateImage({
      model,
      prompt: "draw a map",
      width: 1024,
      height: 768,
      providerOptions: { quality: "high" },
    });

    expect(calls).toEqual([
      {
        prompt: "draw a map",
        width: 1024,
        height: 768,
        providerOptions: { quality: "high" },
      },
    ]);
    expect(response.images[0].data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("uses stable image defaults", async () => {
    const calls: unknown[] = [];
    const model = fakeImageModel(calls);

    await generateImage({ model, prompt: "draw" });

    expect(calls).toEqual([{ prompt: "draw", width: 1024, height: 1024 }]);
  });

  it("generates speech with explicit options", async () => {
    const calls: unknown[] = [];
    const model: SpeechGenerationModel = {
      provider: "test",
      modelId: "test-speech",
      async speechGeneration(request) {
        calls.push(request);
        return {
          audio: { data: new Uint8Array([4, 5]), mediaType: "audio/mpeg" },
          rawResponse: "raw",
        };
      },
    };

    const response = await generateSpeech({
      model,
      text: "hello",
      voice: "alloy",
      speed: 1.25,
      providerOptions: { format: "mp3" },
    });

    expect(calls).toEqual([
      {
        text: "hello",
        voice: "alloy",
        speed: 1.25,
        providerOptions: { format: "mp3" },
      },
    ]);
    expect(response.audio.data).toEqual(new Uint8Array([4, 5]));
  });

  it("uses the stable speech speed default", async () => {
    const calls: unknown[] = [];
    const model = fakeAudioModel(calls);

    await generateSpeech({ model, text: "hello", voice: "alloy" });

    expect(calls).toEqual([{ text: "hello", voice: "alloy", speed: 1 }]);
  });

  it("transcribes audio with explicit options", async () => {
    const calls: unknown[] = [];
    const model: TranscriptionModel = {
      provider: "test",
      modelId: "test-transcription",
      async transcription(request) {
        calls.push(request);
        return { text: "hello world", rawResponse: { text: "hello world" } };
      },
    };

    const response = await transcribe({
      model,
      audio: { data: new Uint8Array([1, 2, 3]), filename: "hello.mp3" },
      language: "en",
      prompt: "transcribe exactly",
      temperature: 0.2,
      providerOptions: { response_format: "json" },
    });

    expect(calls).toEqual([
      {
        data: new Uint8Array([1, 2, 3]),
        filename: "hello.mp3",
        language: "en",
        prompt: "transcribe exactly",
        temperature: 0.2,
        providerOptions: { response_format: "json" },
      },
    ]);
    expect(response.text).toBe("hello world");
  });

  it("copies ArrayBuffer transcription input before starting the provider request", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received: number[][] = [];
    const model: TranscriptionModel = {
      provider: "test",
      modelId: "test-transcription",
      async transcription(request) {
        await ready;
        received.push([...request.data]);
        return { text: "done", rawResponse: {} };
      },
    };
    const source = new Uint8Array([1, 2, 3]);

    const pending = transcribe({ model, audio: { data: source.buffer, filename: "hello.wav" } });
    source.fill(9);
    release();
    await pending;

    expect(received).toEqual([[1, 2, 3]]);
  });

  it("validates media inputs before calling models", async () => {
    const imageModel = fakeImageModel();
    const audioModel = fakeAudioModel();
    const transcriptionModel = fakeTranscriptionModel();

    await expect(generateImage({ model: imageModel, prompt: "" })).rejects.toThrow(
      "non-empty string",
    );
    await expect(generateImage({ model: imageModel, prompt: "draw", width: 0 })).rejects.toThrow(
      "positive integer",
    );
    await expect(generateSpeech({ model: audioModel, text: "", voice: "alloy" })).rejects.toThrow(
      "non-empty string",
    );
    await expect(generateSpeech({ model: audioModel, text: "hello", voice: "" })).rejects.toThrow(
      "non-empty string",
    );
    await expect(
      generateSpeech({ model: audioModel, text: "hello", voice: "alloy", speed: 0 }),
    ).rejects.toThrow("positive finite number");
    await expect(
      transcribe({
        model: transcriptionModel,
        audio: { data: new Uint8Array(), filename: "audio.mp3" },
      }),
    ).rejects.toThrow("cannot be empty");
    await expect(
      transcribe({
        model: transcriptionModel,
        audio: { data: new Uint8Array([1]), filename: "" },
      }),
    ).rejects.toThrow("non-empty string");
  });

  it("rejects non-JSON provider options before calling media models", async () => {
    const imageCalls: unknown[] = [];
    const speechCalls: unknown[] = [];
    const transcriptionCalls: unknown[] = [];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const providerOptions of [
      { nested: { missing: undefined } },
      { value: Number.POSITIVE_INFINITY },
      cyclic,
      [],
      null,
      "provider-options",
      1,
      true,
      new Date(),
    ]) {
      await expect(
        generateImage({
          model: fakeImageModel(imageCalls),
          prompt: "draw",
          providerOptions: providerOptions as never,
        }),
      ).rejects.toThrow("providerOptions must be a JSON object.");
      await expect(
        generateSpeech({
          model: fakeAudioModel(speechCalls),
          text: "hello",
          voice: "alloy",
          providerOptions: providerOptions as never,
        }),
      ).rejects.toThrow("providerOptions must be a JSON object.");
      await expect(
        transcribe({
          model: fakeTranscriptionModel(transcriptionCalls),
          audio: { data: new Uint8Array([1]), filename: "audio.mp3" },
          providerOptions: providerOptions as never,
        }),
      ).rejects.toThrow("providerOptions must be a JSON object.");
    }

    expect(imageCalls).toHaveLength(0);
    expect(speechCalls).toHaveLength(0);
    expect(transcriptionCalls).toHaveLength(0);
  });

  it.each([
    [
      "image",
      () => generateImage({ model: flakyImageModel(), prompt: "draw", retries: noDelayRetries }),
    ],
    [
      "speech",
      () =>
        generateSpeech({
          model: flakyAudioModel(),
          text: "hello",
          voice: "alloy",
          retries: noDelayRetries,
        }),
    ],
    [
      "transcription",
      () =>
        transcribe({
          model: flakyTranscriptionModel(),
          audio: { data: new Uint8Array([1]), filename: "audio.mp3" },
          retries: noDelayRetries,
        }),
    ],
  ])("retries transient %s provider failures", async (_name, run) => {
    await expect(run()).resolves.toBeDefined();
  });
});

const noDelayRetries = { initialDelayMs: 0, maxDelayMs: 0 } as const;

function fakeImageModel(calls: unknown[] = []): ImageGenerationModel {
  return {
    provider: "test",
    modelId: "test-image",
    async imageGeneration(request) {
      calls.push(request);
      const image = new Uint8Array([1]);
      return { images: [{ data: image }], rawResponse: {} };
    },
  };
}

function fakeAudioModel(calls: unknown[] = []): SpeechGenerationModel {
  return {
    provider: "test",
    modelId: "test-speech",
    async speechGeneration(request) {
      calls.push(request);
      return { audio: { data: new Uint8Array([1]) }, rawResponse: {} };
    },
  };
}

function fakeTranscriptionModel(calls: unknown[] = []): TranscriptionModel {
  return {
    provider: "test",
    modelId: "test-transcription",
    async transcription(request) {
      calls.push(request);
      return { text: "done", rawResponse: {} };
    },
  };
}

function flakyImageModel(): ImageGenerationModel {
  let attempt = 0;
  return {
    provider: "test",
    modelId: "test-image",
    async imageGeneration() {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("unavailable"), { status: 503 });
      const image = new Uint8Array([1]);
      return { images: [{ data: image }], rawResponse: {} };
    },
  };
}

function flakyAudioModel(): SpeechGenerationModel {
  let attempt = 0;
  return {
    provider: "test",
    modelId: "test-speech",
    async speechGeneration() {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("unavailable"), { status: 503 });
      return { audio: { data: new Uint8Array([1]) }, rawResponse: {} };
    },
  };
}

function flakyTranscriptionModel(): TranscriptionModel {
  let attempt = 0;
  return {
    provider: "test",
    modelId: "test-transcription",
    async transcription() {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("unavailable"), { status: 503 });
      return { text: "done", rawResponse: {} };
    },
  };
}
