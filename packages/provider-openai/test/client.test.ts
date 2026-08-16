import type { ModelListingError } from "@anvia/core/model-listing";
import type OpenAI from "openai";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  OpenAIClient,
  type OpenAIClientOptions,
  type OpenAICompletionModelId,
  type OpenAIEmbeddingModelId,
  type OpenAIImageGenerationModelId,
  type OpenAISpeechGenerationModelId,
  type OpenAITranscriptionModelId,
} from "../src/index";

describe("OpenAIClient", () => {
  it("rejects mixed injected and managed configuration", () => {
    const mixed = { client: {} as OpenAI, apiKey: "ignored" };
    expectTypeOf(mixed).not.toMatchTypeOf<OpenAIClientOptions>();
    expect(() => new OpenAIClient(mixed as never)).toThrow(
      "OpenAIClient cannot combine client with apiKey",
    );
  });

  it("types known provider models while accepting custom model strings", () => {
    const client = new OpenAIClient({
      client: { models: { list: async () => ({ data: [] }) } } as never,
    });

    expectTypeOf(
      client.completionModel({ modelId: "gpt-5", api: "responses" }).modelId,
    ).toEqualTypeOf<string>();
    expectTypeOf("gpt-5").toMatchTypeOf<OpenAICompletionModelId>();
    client.completionModel({ modelId: "custom-completion-model", api: "chat" });

    expectTypeOf(client.embeddingModel({ modelId: "text-embedding-3-small" })).toMatchTypeOf<{
      embedTexts(texts: string[]): unknown;
    }>();
    expectTypeOf("text-embedding-3-small").toMatchTypeOf<OpenAIEmbeddingModelId>();
    client.embeddingModel({ modelId: "custom-embedding-model" });

    expectTypeOf("gpt-image-2").toMatchTypeOf<OpenAIImageGenerationModelId>();
    client.imageGenerationModel({ modelId: "custom-image-model" });

    expectTypeOf("tts-1-hd").toMatchTypeOf<OpenAISpeechGenerationModelId>();
    client.speechGenerationModel({ modelId: "custom-speech-model" });

    expectTypeOf("whisper-1").toMatchTypeOf<OpenAITranscriptionModelId>();
    client.transcriptionModel({ modelId: "custom-transcription-model" });
  });

  it("lists OpenAI and compatible gateway models", async () => {
    const client = new OpenAIClient({
      client: {
        models: {
          list: async () => ({
            data: [
              {
                id: "gpt-5",
                object: "model",
                created: 1_700_000_000,
                owned_by: "openai",
              },
              {
                id: "anthropic/claude-opus",
                name: "Claude Opus",
                context_length: 200_000,
              },
            ],
          }),
        },
      } as never,
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "gpt-5",
          type: "model",
          createdAt: 1_700_000_000,
          ownedBy: "openai",
        },
        {
          id: "anthropic/claude-opus",
          name: "Claude Opus",
          contextLength: 200_000,
        },
      ],
    });
  });

  it("preserves model field precedence across compatible aliases", async () => {
    const client = new OpenAIClient({
      client: {
        models: {
          list: async () => ({
            data: [
              {
                id: "compatible-model",
                type: "preferred-type",
                object: "fallback-type",
                created: 100,
                created_at: 200,
                context_length: 300,
                contextLength: 400,
              },
            ],
          }),
        },
      } as never,
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "compatible-model",
          type: "preferred-type",
          createdAt: 200,
          contextLength: 400,
        },
      ],
    });
  });

  it("wraps model listing failures", async () => {
    const client = new OpenAIClient({
      client: {
        models: {
          list: async () => {
            throw Object.assign(new Error("unauthorized"), { status: 401 });
          },
        },
      } as never,
    });

    await expect(client.listModels()).rejects.toMatchObject({
      name: "ModelListingError",
      provider: "OpenAI",
      statusCode: 401,
    } satisfies Partial<ModelListingError>);
  });
});
