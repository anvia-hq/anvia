import { audioGenerationRequest } from "@anvia/core/audio-generation";
import { imageGenerationRequest } from "@anvia/core/image-generation";
import { transcriptionRequest } from "@anvia/core/transcription";
import { describe, expect, it } from "vitest";
import { OpenAIClient } from "../src/index";

describe("OpenAI multimodal models", () => {
  it("maps base64 image responses and preserves all images", async () => {
    const client = mockOpenAIClient();
    const model = new OpenAIClient({ client: client as never }).imageGenerationModel("dall-e-3");

    const response = await imageGenerationRequest(model)
      .prompt("draw a kite")
      .width(1024)
      .height(1024)
      .additionalParams({ n: 2 })
      .send();

    expect(client.images.generateCalls[0]).toEqual({
      model: "dall-e-3",
      prompt: "draw a kite",
      size: "1024x1024",
      response_format: "b64_json",
      n: 2,
    });
    expect(response.image).toEqual(new Uint8Array([1, 2, 3]));
    expect(response.images).toEqual([
      { data: new Uint8Array([1, 2, 3]), mediaType: "image/png" },
      { data: new Uint8Array([4, 5, 6]), mediaType: "image/png" },
    ]);
  });

  it("does not send legacy response_format for GPT image models", async () => {
    const client = mockOpenAIClient();
    const model = new OpenAIClient({ client: client as never }).imageGenerationModel("gpt-image-2");

    await imageGenerationRequest(model)
      .prompt("draw a product diagram")
      .width(1024)
      .height(1024)
      .additionalParams({ output_format: "png" })
      .send();

    expect(client.images.generateCalls[0]).toEqual({
      model: "gpt-image-2",
      prompt: "draw a product diagram",
      size: "1024x1024",
      output_format: "png",
    });
  });

  it("rejects malformed image responses", async () => {
    const client = mockOpenAIClient({ imageResponse: { output_format: "png", data: [] } });
    const model = new OpenAIClient({ client: client as never }).imageGenerationModel();

    await expect(imageGenerationRequest(model).prompt("x").send()).rejects.toThrow(
      "OpenAI image generation response contained no base64 images.",
    );
  });

  it("rejects url-only image responses with an unsupported response error", async () => {
    const client = mockOpenAIClient({
      imageResponse: {
        data: [{ url: "https://example.com/generated.png" }],
      },
    });
    const model = new OpenAIClient({ client: client as never }).imageGenerationModel();

    await expect(imageGenerationRequest(model).prompt("x").send()).rejects.toThrow(
      "OpenAI image generation response contained image URLs, which are not supported.",
    );
  });

  it("maps speech responses to Uint8Array audio", async () => {
    const client = mockOpenAIClient();
    const model = new OpenAIClient({ client: client as never }).audioGenerationModel("tts-test");

    const response = await audioGenerationRequest(model)
      .text("hello")
      .voice("alloy")
      .speed(1.5)
      .additionalParams({ response_format: "wav" })
      .send();

    expect(client.audio.speech.createCalls[0]).toEqual({
      model: "tts-test",
      input: "hello",
      voice: "alloy",
      speed: 1.5,
      response_format: "wav",
    });
    expect(response.audio).toEqual(new Uint8Array([7, 8, 9]));
    expect(response.mediaType).toBe("audio/wav");
  });

  it("maps object transcription responses to text", async () => {
    const client = mockOpenAIClient({ transcriptionResponse: { text: "object text" } });
    const model = new OpenAIClient({ client: client as never }).transcriptionModel("whisper-test");

    const response = await transcriptionRequest(model)
      .data(new Uint8Array([1, 2, 3]))
      .filename("audio.mp3")
      .language("en")
      .prompt("exact")
      .temperature(0.1)
      .additionalParams({ response_format: "json" })
      .send();

    expect(client.audio.transcriptions.createCalls[0]).toMatchObject({
      model: "whisper-test",
      language: "en",
      prompt: "exact",
      temperature: 0.1,
      response_format: "json",
    });
    expect(response.text).toBe("object text");
  });

  it("maps string transcription responses to text", async () => {
    const client = mockOpenAIClient({ transcriptionResponse: "plain text" });
    const model = new OpenAIClient({ client: client as never }).transcriptionModel();

    const response = await transcriptionRequest(model)
      .data(new Uint8Array([1]))
      .filename("audio.wav")
      .send();

    expect(response.text).toBe("plain text");
  });

  it("propagates provider errors", async () => {
    const error = new Error("provider failed");
    const client = mockOpenAIClient({ imageError: error });
    const model = new OpenAIClient({ client: client as never }).imageGenerationModel();

    await expect(imageGenerationRequest(model).prompt("x").send()).rejects.toBe(error);
  });
});

function mockOpenAIClient(
  options: {
    imageError?: Error | undefined;
    imageResponse?: unknown;
    transcriptionResponse?: unknown;
  } = {},
) {
  const generateCalls: unknown[] = [];
  const speechCreateCalls: unknown[] = [];
  const transcriptionCreateCalls: unknown[] = [];
  return {
    images: {
      generateCalls,
      async generate(params: unknown) {
        generateCalls.push(params);
        if (options.imageError !== undefined) {
          throw options.imageError;
        }
        return (
          options.imageResponse ?? {
            output_format: "png",
            data: [
              { b64_json: Buffer.from([1, 2, 3]).toString("base64") },
              { b64_json: Buffer.from([4, 5, 6]).toString("base64") },
            ],
          }
        );
      },
    },
    audio: {
      speech: {
        createCalls: speechCreateCalls,
        async create(params: unknown) {
          speechCreateCalls.push(params);
          return {
            async arrayBuffer() {
              return new Uint8Array([7, 8, 9]).buffer;
            },
          };
        },
      },
      transcriptions: {
        createCalls: transcriptionCreateCalls,
        async create(params: unknown) {
          transcriptionCreateCalls.push(params);
          return options.transcriptionResponse ?? { text: "transcribed" };
        },
      },
    },
  };
}
