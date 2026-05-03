import { imageGenerationRequest } from "@anvia/core/image-generation";
import { transcriptionRequest } from "@anvia/core/transcription";
import { describe, expect, it } from "vitest";
import { GeminiClient } from "../src/index";

describe("Gemini multimodal models", () => {
  it("maps native Gemini image responses and derives aspect ratio", async () => {
    const client = mockGeminiClient();
    const model = new GeminiClient({ client: client as never }).imageGenerationModel("gemini-test");

    const response = await imageGenerationRequest(model)
      .prompt("draw a diagram")
      .width(1024)
      .height(768)
      .send();

    expect(client.models.generateContentCalls[0]).toEqual({
      model: "gemini-test",
      contents: "draw a diagram",
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "4:3" },
      },
    });
    expect(response.image).toEqual(new Uint8Array([1, 2, 3]));
    expect(response.mediaType).toBe("image/png");
  });

  it("lets caller-provided native Gemini image config override derived aspect ratio", async () => {
    const client = mockGeminiClient();
    const model = new GeminiClient({ client: client as never }).imageGenerationModel();

    await imageGenerationRequest(model)
      .prompt("draw")
      .width(1024)
      .height(768)
      .additionalParams({
        config: { imageConfig: { aspectRatio: "16:9", imageSize: "2K" } },
      })
      .send();

    expect(client.models.generateContentCalls[0]).toMatchObject({
      config: {
        imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
  });

  it("keeps Imagen generation on the explicit Imagen model factory", async () => {
    const client = mockGeminiClient();
    const model = new GeminiClient({ client: client as never }).imagenGenerationModel(
      "imagen-test",
    );

    const response = await imageGenerationRequest(model)
      .prompt("draw a diagram")
      .width(1024)
      .height(768)
      .additionalParams({ config: { aspectRatio: "16:9", numberOfImages: 2 } })
      .send();

    expect(client.models.generateImagesCalls[0]).toEqual({
      model: "imagen-test",
      prompt: "draw a diagram",
      config: { aspectRatio: "16:9", numberOfImages: 2 },
    });
    expect(response.image).toEqual(new Uint8Array([4, 5, 6]));
    expect(response.mediaType).toBe("image/jpeg");
  });

  it("maps transcription requests through generateContent inline audio", async () => {
    const client = mockGeminiClient();
    const model = new GeminiClient({ client: client as never }).transcriptionModel("gemini-test");

    const response = await transcriptionRequest(model)
      .data(new Uint8Array([7, 8, 9]))
      .filename("voice.wav")
      .prompt("Use support terminology.")
      .temperature(0.2)
      .additionalParams({ topP: 0.8 })
      .send();

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
        topP: 0.8,
        temperature: 0.2,
        systemInstruction:
          "Translate the provided audio exactly. Do not add additional information.\n\nUse support terminology.",
      },
    });
    expect(response.text).toBe("transcribed text");
  });
});

function mockGeminiClient() {
  const generateImagesCalls: unknown[] = [];
  const generateContentCalls: unknown[] = [];
  return {
    models: {
      generateImagesCalls,
      async generateImages(params: unknown) {
        generateImagesCalls.push(params);
        return {
          generatedImages: [
            {
              image: {
                imageBytes: Buffer.from([4, 5, 6]).toString("base64"),
                mimeType: "image/jpeg",
              },
            },
          ],
        };
      },
      generateContentCalls,
      async generateContent(params: unknown) {
        generateContentCalls.push(params);
        return {
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
        };
      },
    },
  };
}
