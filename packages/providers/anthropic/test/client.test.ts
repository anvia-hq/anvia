import { Message } from "@anvia/core";
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
});
