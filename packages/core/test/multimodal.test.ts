import { describe, expect, it } from "vitest";
import { type AudioGenerationModel, audioGenerationRequest } from "../src/audio-generation";
import { type ImageGenerationModel, imageGenerationRequest } from "../src/image-generation";
import { type TranscriptionModel, transcriptionRequest } from "../src/transcription";

describe("multimodal request builders", () => {
  it("builds image generation requests and calls the model", async () => {
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

    const response = await imageGenerationRequest(model)
      .prompt("draw a map")
      .width(1024)
      .height(768)
      .additionalParams({ quality: "high" })
      .send();

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

  it("uses stable image generation defaults", () => {
    expect(imageGenerationRequest(fakeImageModel()).build()).toEqual({
      prompt: "",
      width: 1024,
      height: 1024,
    });
  });

  it("builds audio generation requests and calls the model", async () => {
    const calls: unknown[] = [];
    const model: AudioGenerationModel = {
      async audioGeneration(request) {
        calls.push(request);
        return {
          audio: new Uint8Array([4, 5]),
          mediaType: "audio/mpeg",
          rawResponse: "raw",
        };
      },
    };

    const response = await audioGenerationRequest(model)
      .text("hello")
      .voice("alloy")
      .speed(1.25)
      .additionalParams({ format: "mp3" })
      .send();

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

  it("uses stable audio generation defaults", () => {
    expect(audioGenerationRequest(fakeAudioModel()).build()).toEqual({
      text: "",
      voice: "",
      speed: 1,
    });
  });

  it("builds transcription requests and calls the model", async () => {
    const calls: unknown[] = [];
    const model: TranscriptionModel = {
      async transcription(request) {
        calls.push(request);
        return {
          text: "hello world",
          rawResponse: { text: "hello world" },
        };
      },
    };

    const response = await transcriptionRequest(model)
      .data(new Uint8Array([1, 2, 3]))
      .filename("hello.mp3")
      .language("en")
      .prompt("transcribe exactly")
      .temperature(0.2)
      .additionalParams({ response_format: "json" })
      .send();

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

  it("rejects empty transcription data", () => {
    expect(() => transcriptionRequest(fakeTranscriptionModel()).build()).toThrow(
      "Transcription data cannot be empty.",
    );
  });
});

function fakeImageModel(): ImageGenerationModel {
  return {
    async imageGeneration() {
      throw new Error("not called");
    },
  };
}

function fakeAudioModel(): AudioGenerationModel {
  return {
    async audioGeneration() {
      throw new Error("not called");
    },
  };
}

function fakeTranscriptionModel(): TranscriptionModel {
  return {
    async transcription() {
      throw new Error("not called");
    },
  };
}
