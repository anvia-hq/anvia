import { describe, expect, it } from "vitest";
import { GrokSpeechGenerationModel, GrokTranscriptionModel } from "../src/index";

describe("Grok batch media models", () => {
  it("maps speech generation to xAI TTS and returns binary audio", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }) as typeof fetch;
    const model = new GrokSpeechGenerationModel({
      apiKey: "key",
      baseUrl: "https://api.x.ai/v1",
      fetch: fetchFn,
    });

    const response = await model.speechGeneration({
      text: "Hello",
      voice: "eve",
      speed: 1,
      providerOptions: {
        language: "id",
        output_format: { codec: "mp3", sample_rate: 24_000 },
      },
    });

    expect(calls[0]?.url).toBe("https://api.x.ai/v1/tts");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      text: "Hello",
      voice_id: "eve",
      language: "id",
      output_format: { codec: "mp3", sample_rate: 24_000 },
    });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer key");
    expect(Array.from(response.audio.data)).toEqual([1, 2, 3]);
    expect(response.audio.mediaType).toBe("audio/mpeg");
  });

  it("accepts base64 JSON TTS responses and rejects unsupported speed", async () => {
    const model = new GrokSpeechGenerationModel({
      apiKey: "key",
      baseUrl: "https://api.x.ai/v1",
      fetch: async () =>
        Response.json({
          audio: "AQID",
          media_type: "audio/wav",
        }),
    });

    await expect(
      model.speechGeneration({ text: "Hello", voice: "eve", speed: 1 }),
    ).resolves.toMatchObject({
      audio: { data: new Uint8Array([1, 2, 3]), mediaType: "audio/wav" },
    });
    await expect(
      model.speechGeneration({ text: "Hello", voice: "eve", speed: 1.5 }),
    ).rejects.toThrow("does not expose speed control");
  });

  it("maps transcription to multipart xAI STT with the file last", async () => {
    const entries: Array<[string, string | Blob]> = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      entries.push(...form.entries());
      return Response.json({ text: "hello", duration: 1.2 });
    }) as typeof fetch;
    const model = new GrokTranscriptionModel({
      apiKey: "key",
      baseUrl: "https://api.x.ai/v1",
      fetch: fetchFn,
    });

    const response = await model.transcription({
      data: new Uint8Array([1, 2, 3]),
      filename: "speech.mp3",
      language: "en",
      providerOptions: {
        format: true,
        keyterm: ["Anvia", "Grok"],
      },
    });

    expect(entries.slice(0, -1)).toEqual([
      ["format", "true"],
      ["keyterm", "Anvia"],
      ["keyterm", "Grok"],
      ["language", "en"],
    ]);
    expect(entries.at(-1)?.[0]).toBe("file");
    expect(response).toMatchObject({ text: "hello", rawResponse: { duration: 1.2 } });
  });

  it("rejects unsupported generic transcription options", async () => {
    const model = new GrokTranscriptionModel({
      apiKey: "key",
      baseUrl: "https://api.x.ai/v1",
      fetch: async () => Response.json({ text: "unused" }),
    });

    await expect(
      model.transcription({
        data: new Uint8Array([1]),
        filename: "speech.mp3",
        prompt: "names",
      }),
    ).rejects.toThrow("does not support prompt");
    await expect(
      model.transcription({
        data: new Uint8Array([1]),
        filename: "speech.mp3",
        temperature: 0,
      }),
    ).rejects.toThrow("does not support temperature");
  });
});
