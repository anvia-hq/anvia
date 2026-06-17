import type { ModelListingError } from "@anvia/core/model-listing";
import { describe, expect, it } from "vitest";
import { OpenAIClient } from "../src/index";

describe("OpenAIClient", () => {
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
