import { generateImage } from "@anvia/core/image-generation";
import { transcribe } from "@anvia/core/transcription";
import { describe, expect, it } from "vitest";
import { GeminiClient } from "../src/index";

describe("Gemini multimodal models", () => {
  it("maps native Gemini image responses and derives aspect ratio", async () => {
    const client = mockGeminiClient();
    const model = new GeminiClient({ client: client as never }).imageGenerationModel({
      api: "generateContent",
      modelId: "gemini-test",
    });

    const response = await generateImage({
      model,
      prompt: "draw a diagram",
      width: 1024,
      height: 768,
    });

    expect(client.models.generateContentCalls[0]).toEqual({
      model: "gemini-test",
      contents: "draw a diagram",
      config: {
        httpOptions: { retryOptions: { attempts: 1 } },
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "4:3" },
      },
    });
    expect(response.images[0].data).toEqual(new Uint8Array([1, 2, 3]));
    expect(response.images[0].mediaType).toBe("image/png");
  });

  it("preserves provider image config while canonical dimensions win", async () => {
    const client = mockGeminiClient();
    const model = new GeminiClient({ client: client as never }).imageGenerationModel({
      api: "generateContent",
      modelId: "gemini-2.5-flash-image",
    });

    await generateImage({
      model,
      prompt: "draw",
      width: 1024,
      height: 768,
      providerOptions: {
        config: { imageConfig: { aspectRatio: "16:9", imageSize: "2K" } },
      },
    });

    expect(client.models.generateContentCalls[0]).toMatchObject({
      config: {
        imageConfig: { aspectRatio: "4:3", imageSize: "2K" },
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
  });

  it("keeps Imagen generation on the explicit Imagen model factory", async () => {
    const client = mockGeminiClient();
    const model = new GeminiClient({ client: client as never }).imageGenerationModel({
      api: "generateImages",
      modelId: "imagen-test",
    });

    const response = await generateImage({
      model,
      prompt: "draw a diagram",
      width: 1024,
      height: 768,
      providerOptions: { config: { aspectRatio: "16:9", numberOfImages: 2 } },
    });

    expect(client.models.generateImagesCalls[0]).toEqual({
      model: "imagen-test",
      prompt: "draw a diagram",
      config: {
        aspectRatio: "4:3",
        numberOfImages: 2,
        httpOptions: { retryOptions: { attempts: 1 } },
      },
    });
    expect(response.images[0].data).toEqual(new Uint8Array([4, 5, 6]));
    expect(response.images[0].mediaType).toBe("image/jpeg");
  });

  it("rejects malformed native Gemini image responses", async () => {
    const client = mockGeminiClient({
      generateContentResponse: {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: "not base64!!!", mimeType: "image/png" } }],
            },
          },
        ],
      },
    });
    const model = new GeminiClient({ client: client as never }).imageGenerationModel({
      api: "generateContent",
      modelId: "gemini-test",
    });

    await expect(generateImage({ model, prompt: "draw" })).rejects.toThrow(
      "Gemini image generation response contained invalid base64 image data.",
    );
  });

  it("rejects malformed Imagen image responses", async () => {
    const client = mockGeminiClient({
      generateImagesResponse: {
        generatedImages: [
          {
            image: {
              imageBytes: "not base64!!!",
              mimeType: "image/jpeg",
            },
          },
        ],
      },
    });
    const model = new GeminiClient({ client: client as never }).imageGenerationModel({
      api: "generateImages",
      modelId: "imagen-test",
    });

    await expect(generateImage({ model, prompt: "draw" })).rejects.toThrow(
      "Gemini image generation response contained invalid base64 image data.",
    );
  });

  it("maps transcription requests through generateContent inline audio", async () => {
    const client = mockGeminiClient();
    const model = new GeminiClient({ client: client as never }).transcriptionModel({
      modelId: "gemini-test",
    });

    const response = await transcribe({
      model,
      audio: { data: new Uint8Array([7, 8, 9]), filename: "voice.wav" },
      prompt: "Use support terminology.",
      temperature: 0.2,
      providerOptions: { topP: 0.8 },
    });

    expect(client.models.generateContentCalls[0]).toEqual({
      model: "gemini-test",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: Buffer.from([7, 8, 9]).toString("base64"),
              },
            },
          ],
        },
      ],
      config: {
        httpOptions: { retryOptions: { attempts: 1 } },
        topP: 0.8,
        temperature: 0.2,
        systemInstruction:
          "Transcribe the provided audio exactly. Do not add additional information.\n\nUse support terminology.",
      },
    });
    expect(response.text).toBe("transcribed text");
  });
});

function mockGeminiClient(
  responses: { generateContentResponse?: unknown; generateImagesResponse?: unknown } = {},
) {
  const generateImagesCalls: unknown[] = [];
  const generateContentCalls: unknown[] = [];
  return {
    models: {
      generateImagesCalls,
      async generateImages(params: unknown) {
        generateImagesCalls.push(params);
        return (
          responses.generateImagesResponse ?? {
            generatedImages: [
              {
                image: {
                  imageBytes: Buffer.from([4, 5, 6]).toString("base64"),
                  mimeType: "image/jpeg",
                },
              },
            ],
          }
        );
      },
      generateContentCalls,
      async generateContent(params: unknown) {
        generateContentCalls.push(params);
        return (
          responses.generateContentResponse ?? {
            candidates: [
              {
                content: {
                  parts: [
                    { text: "transcribed text" },
                    {
                      inlineData: {
                        data: Buffer.from([1, 2, 3]).toString("base64"),
                        mimeType: "image/png",
                      },
                    },
                  ],
                },
              },
            ],
          }
        );
      },
    },
  };
}
