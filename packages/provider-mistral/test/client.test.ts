import type { Mistral } from "@mistralai/mistralai";
import type { NoCompletionModelControls } from "@anvia/core/completion";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  MistralClient,
  type MistralClientOptions,
  type MistralCompletionModelId,
  type MistralOcrModelId,
} from "../src/index";

describe("MistralClient", () => {
  it("rejects mixed injected and managed configuration", () => {
    const mixed = { client: fakeSdk() as unknown as Mistral, apiKey: "ignored" };
    expectTypeOf(mixed).not.toMatchTypeOf<MistralClientOptions>();
    expect(() => new MistralClient(mixed as never)).toThrow(
      "MistralClient cannot combine client with apiKey",
    );
  });

  it("types known Mistral models while accepting custom model strings", () => {
    const client = new MistralClient({ client: fakeSdk() as never });

    expectTypeOf(
      client.completionModel({ modelId: "mistral-large-latest" }).modelId,
    ).toEqualTypeOf<string>();
    const completionId: MistralCompletionModelId = "custom-mistral-model";
    const completionModel = client.completionModel({ modelId: completionId });
    expectTypeOf(completionModel.controls).toEqualTypeOf<NoCompletionModelControls | undefined>();

    client.embeddingModel({ modelId: "mistral-embed" });
    client.embeddingModel({ modelId: "custom-mistral-embedding" });

    expectTypeOf(
      client.ocrModel({ modelId: "mistral-ocr-latest" }).modelId,
    ).toEqualTypeOf<MistralOcrModelId>();
    const ocrId: MistralOcrModelId = "custom-mistral-ocr";
    client.ocrModel({ modelId: ocrId });
  });

  it("validates explicit Mistral credentials", () => {
    expect(() => new MistralClient({} as never)).toThrow(
      "Missing Mistral credentials. Pass apiKey when constructing MistralClient.",
    );
  });

  it("creates completion, embedding, and OCR models with an injected SDK client", () => {
    const client = new MistralClient({ client: fakeSdk() as never });

    expect(client.completionModel({ modelId: "mistral-large-latest" }).modelId).toBe(
      "mistral-large-latest",
    );
    expect(client.embeddingModel({ modelId: "mistral-embed" }).modelId).toBe("mistral-embed");
    expect(client.ocrModel({ modelId: "mistral-ocr-latest" }).modelId).toBe("mistral-ocr-latest");
  });

  it("lists models from the Mistral SDK", async () => {
    const client = new MistralClient({
      client: {
        models: {
          list: async () => ({
            data: [
              {
                id: "mistral-large-latest",
                name: "Mistral Large",
                description: "Large model.",
                created: 1_700_000_000,
                ownedBy: "mistralai",
                maxContextLength: 128_000,
                type: "base",
              },
            ],
          }),
        },
      } as never,
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "mistral-large-latest",
          name: "Mistral Large",
          description: "Large model.",
          type: "base",
          createdAt: 1_700_000_000,
          ownedBy: "mistralai",
          contextLength: 128_000,
        },
      ],
    });
  });

  it("preserves model field precedence across compatible aliases", async () => {
    const client = new MistralClient({
      client: {
        models: {
          list: async () => ({
            data: [
              {
                id: "mistral-compatible",
                ownedBy: "camel-owner",
                owned_by: "preferred-owner",
                maxContextLength: 100_000,
                max_context_length: 200_000,
              },
            ],
          }),
        },
      } as never,
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "mistral-compatible",
          ownedBy: "preferred-owner",
          contextLength: 200_000,
        },
      ],
    });
  });
});

function fakeSdk() {
  return {
    chat: {
      complete: async () => ({}),
      stream: async function* () {},
    },
    embeddings: {
      create: async () => ({ data: [] }),
    },
    files: {
      upload: async () => ({ id: "file-test" }),
    },
    ocr: {
      process: async () => ({}),
    },
  };
}
