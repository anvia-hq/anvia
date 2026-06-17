import { Message } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { AnthropicClient, AnthropicCompletionModel } from "../src/index";

describe("Anthropic client", () => {
  it("uses the Anthropic client for custom Messages base URLs", async () => {
    const calls: unknown[] = [];
    const client = {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return {
            id: "msg_1",
            content: [{ type: "text", text: "ok" }],
            usage: {},
          };
        },
      },
    };

    const anthropic = new AnthropicClient({
      client: client as never,
    });
    const model = anthropic.completionModel("custom-messages-model");

    expect(model).toBeInstanceOf(AnthropicCompletionModel);
    await model.completion({
      chatHistory: [Message.user("hello")],
      documents: [],
      tools: [],
    });
    expect(calls).toEqual([
      {
        model: "custom-messages-model",
        max_tokens: 1024,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      },
    ]);
  });

  it("lists models from the Anthropic SDK", async () => {
    const client = {
      models: {
        list: async () =>
          asyncIterable([
            {
              id: "claude-sonnet-4-20250514",
              display_name: "Claude Sonnet 4",
              created_at: "2025-05-14T00:00:00Z",
              max_input_tokens: 200_000,
              type: "model",
            },
          ]),
      },
    };

    const anthropic = new AnthropicClient({ client: client as never });

    await expect(anthropic.listModels()).resolves.toEqual({
      data: [
        {
          id: "claude-sonnet-4-20250514",
          name: "Claude Sonnet 4",
          type: "model",
          createdAt: 1_747_180_800,
          contextLength: 200_000,
        },
      ],
    });
  });
});

async function* asyncIterable(items: unknown[]): AsyncIterable<unknown> {
  for (const item of items) {
    yield item;
  }
}
