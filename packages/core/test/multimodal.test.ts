import { describe, expect, it } from "vitest";
import { type AudioGenerationModel, generateSpeech } from "../src/audio-generation";
import { generateImage, type ImageGenerationModel } from "../src/image-generation";
import { type TranscriptionModel, transcribe } from "../src/transcription";

describe("direct multimodal model APIs", () => {
  it("generates images with explicit options", async () => {
    const calls: unknown[] = [];
    const model: ImageGenerationModel = {
      async imageGeneration(request) {
        calls.push(request);
        const image = new Uint8Array([1, 2, 3]);
        return {
          image,
          images: [{ data: image, mediaType: "image/png" }],
          mediaType: "image/png",
          rawResponse: { ok: true },
        };
      },
    };

    const response = await generateImage("draw a map", {
      model,
      width: 1024,
      height: 768,
      additionalParams: { quality: "high" },
    });

    expect(calls).toEqual([
      {
        prompt: "draw a map",
        width: 1024,
        height: 768,
        additionalParams: { quality: "high" },
      },
    ]);
    expect(response.image).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("uses stable image defaults", async () => {
    const calls: unknown[] = [];
    const model = fakeImageModel(calls);

    await generateImage("draw", { model });

    expect(calls).toEqual([{ prompt: "draw", width: 1024, height: 1024 }]);
  });

  it("generates speech with explicit options", async () => {
    const calls: unknown[] = [];
    const model: AudioGenerationModel = {
      async audioGeneration(request) {
        calls.push(request);
        return { audio: new Uint8Array([4, 5]), mediaType: "audio/mpeg", rawResponse: "raw" };
      },
    };

    const response = await generateSpeech("hello", {
      model,
      voice: "alloy",
      speed: 1.25,
      additionalParams: { format: "mp3" },
    });

    expect(calls).toEqual([
      {
        text: "hello",
        voice: "alloy",
        speed: 1.25,
        additionalParams: { format: "mp3" },
      },
    ]);
    expect(response.audio).toEqual(new Uint8Array([4, 5]));
  });

  it("uses the stable speech speed default", async () => {
    const calls: unknown[] = [];
    const model = fakeAudioModel(calls);

    await generateSpeech("hello", { model, voice: "alloy" });

    expect(calls).toEqual([{ text: "hello", voice: "alloy", speed: 1 }]);
  });

  it("transcribes audio with explicit options", async () => {
    const calls: unknown[] = [];
    const model: TranscriptionModel = {
      async transcription(request) {
        calls.push(request);
        return { text: "hello world", rawResponse: { text: "hello world" } };
      },
    };

    const response = await transcribe(new Uint8Array([1, 2, 3]), {
      model,
      filename: "hello.mp3",
      language: "en",
      prompt: "transcribe exactly",
      temperature: 0.2,
      additionalParams: { response_format: "json" },
    });

    expect(calls).toEqual([
      {
        data: new Uint8Array([1, 2, 3]),
        filename: "hello.mp3",
        language: "en",
        prompt: "transcribe exactly",
        temperature: 0.2,
        additionalParams: { response_format: "json" },
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
      async transcription(request) {
        await ready;
        received.push([...request.data]);
        return { text: "done", rawResponse: {} };
      },
    };
    const source = new Uint8Array([1, 2, 3]);

    const pending = transcribe(source.buffer, { model, filename: "hello.wav" });
    source.fill(9);
    release();
    await pending;

    expect(received).toEqual([[1, 2, 3]]);
  });

  it("validates media inputs before calling models", () => {
    const imageModel = fakeImageModel();
    const audioModel = fakeAudioModel();
    const transcriptionModel = fakeTranscriptionModel();

    expect(() => generateImage("", { model: imageModel })).toThrow("non-empty string");
    expect(() => generateImage("draw", { model: imageModel, width: 0 })).toThrow(
      "positive integer",
    );
    expect(() => generateSpeech("", { model: audioModel, voice: "alloy" })).toThrow(
      "non-empty string",
    );
    expect(() => generateSpeech("hello", { model: audioModel, voice: "" })).toThrow(
      "non-empty string",
    );
    expect(() => generateSpeech("hello", { model: audioModel, voice: "alloy", speed: 0 })).toThrow(
      "positive finite number",
    );
    expect(() =>
      transcribe(new Uint8Array(), { model: transcriptionModel, filename: "audio.mp3" }),
    ).toThrow("cannot be empty");
    expect(() =>
      transcribe(new Uint8Array([1]), { model: transcriptionModel, filename: "" }),
    ).toThrow("non-empty string");
  });

  it.each([
    ["image", () => generateImage("draw", { model: flakyImageModel(), retries: noDelayRetries })],
    [
      "speech",
      () =>
        generateSpeech("hello", {
          model: flakyAudioModel(),
          voice: "alloy",
          retries: noDelayRetries,
        }),
    ],
    [
      "transcription",
      () =>
        transcribe(new Uint8Array([1]), {
          model: flakyTranscriptionModel(),
          filename: "audio.mp3",
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
    async imageGeneration(request) {
      calls.push(request);
      const image = new Uint8Array([1]);
      return { image, images: [{ data: image }], rawResponse: {} };
    },
  };
}

function fakeAudioModel(calls: unknown[] = []): AudioGenerationModel {
  return {
    async audioGeneration(request) {
      calls.push(request);
      return { audio: new Uint8Array([1]), rawResponse: {} };
    },
  };
}

function fakeTranscriptionModel(): TranscriptionModel {
  return {
    async transcription() {
      return { text: "done", rawResponse: {} };
    },
  };
}

function flakyImageModel(): ImageGenerationModel {
  let attempt = 0;
  return {
    async imageGeneration() {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("unavailable"), { status: 503 });
      const image = new Uint8Array([1]);
      return { image, images: [{ data: image }], rawResponse: {} };
    },
  };
}

function flakyAudioModel(): AudioGenerationModel {
  let attempt = 0;
  return {
    async audioGeneration() {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("unavailable"), { status: 503 });
      return { audio: new Uint8Array([1]), rawResponse: {} };
    },
  };
}

function flakyTranscriptionModel(): TranscriptionModel {
  let attempt = 0;
  return {
    async transcription() {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("unavailable"), { status: 503 });
      return { text: "done", rawResponse: {} };
    },
  };
}
