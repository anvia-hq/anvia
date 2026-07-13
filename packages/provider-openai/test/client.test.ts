import type { ModelListingError } from "@anvia/core/model-listing";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  OpenAIClient,
  type OpenAICompletionModelName,
  type OpenAIEmbeddingModelName,
  type OpenAIImageGenerationModelName,
  type OpenAITranscriptionModelName,
} from "../src/index";

describe("OpenAIClient", () => {
  it("types known provider models while accepting custom model strings", () => {
    const client = new OpenAIClient({
      client: { models: { list: async () => ({ data: [] }) } } as never,
    });

    expectTypeOf(
      client.completionModel("gpt-5").defaultModel,
    ).toEqualTypeOf<OpenAICompletionModelName>();
    client.completionModel("custom-completion-model");

    expectTypeOf(client.embeddingModel("text-embedding-3-small")).toMatchTypeOf<{
      embedTexts(texts: string[]): unknown;
    }>();
    expectTypeOf("text-embedding-3-small").toMatchTypeOf<OpenAIEmbeddingModelName>();
    client.embeddingModel("custom-embedding-model");

    expectTypeOf(
      client.imageGenerationModel("gpt-image-2").defaultModel,
    ).toEqualTypeOf<OpenAIImageGenerationModelName>();
    client.imageGenerationModel("custom-image-model");

    client.audioGenerationModel("tts-1-hd");
    client.audioGenerationModel("custom-audio-model");

    expectTypeOf(
      client.transcriptionModel("whisper-1").defaultModel,
    ).toEqualTypeOf<OpenAITranscriptionModelName>();
    client.transcriptionModel("custom-transcription-model");
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
