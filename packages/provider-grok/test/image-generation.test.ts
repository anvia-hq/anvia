import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { aspectRatio, GrokImageGenerationModel, imageResponseFromGrok } from "../src/index";

describe("Grok image generation", () => {
  it("maps core image requests to xAI image generation params", async () => {
    const calls: unknown[] = [];
    const model = new GrokImageGenerationModel(
      {
        images: {
          generate: async (params: unknown) => {
            calls.push(params);
            return {
              data: [
                {
                  b64_json: Buffer.from([1, 2, 3]).toString("base64"),
                  mime_type: "image/jpeg",
                },
              ],
            };
          },
        },
      } as never,
      "grok-image-test",
    );

    const response = await model.imageGeneration({
      prompt: "draw a diagram",
      width: 1024,
      height: 768,
      additionalParams: {
        n: 2,
        resolution: "720p",
      },
    });

    expect(calls).toEqual([
      {
        model: "grok-image-test",
        prompt: "draw a diagram",
        n: 2,
        response_format: "b64_json",
        aspect_ratio: "4:3",
        resolution: "720p",
      },
    ]);
    expect(Array.from(response.image)).toEqual([1, 2, 3]);
    expect(response.mediaType).toBe("image/jpeg");
  });

  it("fetches URL image responses into bytes", async () => {
    const fetchCalls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/jpeg; charset=utf-8" },
        arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
      } as unknown as Response;
    }) as typeof fetch;

    const response = await imageResponseFromGrok(
      {
        data: [{ url: "https://imgen.x.ai/example.jpeg" }],
      },
      fetchFn,
    );

    expect(fetchCalls).toEqual(["https://imgen.x.ai/example.jpeg"]);
    expect(Array.from(response.image)).toEqual([4, 5, 6]);
    expect(response.mediaType).toBe("image/jpeg");
  });

  it("rejects URL image responses without fetch", async () => {
    await expect(
      imageResponseFromGrok({ data: [{ url: "https://imgen.x.ai/example.png" }] }, undefined),
    ).rejects.toThrow("no fetch implementation");
  });

  it("rejects empty image responses", async () => {
    await expect(imageResponseFromGrok({ data: [] })).rejects.toThrow(
      "Grok image generation response contained no images.",
    );
  });

  it("normalizes aspect ratios", () => {
    expect(aspectRatio(1024, 1024)).toBe("1:1");
    expect(aspectRatio(1920, 1080)).toBe("16:9");
    expect(aspectRatio(768, 1024)).toBe("3:4");
  });

  it("rejects invalid aspect ratio dimensions", () => {
    expect(() => aspectRatio(Number.NaN, 1024)).toThrow("width must be a finite positive number");
    expect(() => aspectRatio(Number.POSITIVE_INFINITY, 1024)).toThrow(
      "width must be a finite positive number",
    );
    expect(() => aspectRatio(1024, Number.NEGATIVE_INFINITY)).toThrow(
      "height must be a finite positive number",
    );
    expect(() => aspectRatio(0, 1024)).toThrow("width must be a positive number");
    expect(() => aspectRatio(-1, 1024)).toThrow("width must be a positive number");
    expect(() => aspectRatio(1024, 0)).toThrow("height must be a positive number");
    expect(() => aspectRatio(1024, -1)).toThrow("height must be a positive number");
  });
});
