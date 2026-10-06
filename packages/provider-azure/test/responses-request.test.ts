import type { CompletionRequest } from "@anvia/core/completion";
import { OpenAIClient } from "@anvia/openai";
import { describe, expect, it, vi } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { AzureOpenAIClient } from "../src/index";

const request: CompletionRequest = {
  chatHistory: [
    Message.user("Weather?"),
    Message.assistant("Checking."),
    Message.assistant([
      {
        type: "tool-call",
        toolCallId: "item_1",
        callId: "call_1",
        toolName: "weather",
        input: {},
      },
    ]),
    Message.toolResult("item_1", "Sunny", { callId: "call_1", toolName: "weather" }),
  ],
  documents: [],
  tools: [],
};
const response = { id: "response_1", status: "completed", output: [], usage: {} };

describe("Azure Responses requests", () => {
  it.each([false, true])(
    "tags messages for Foundry without altering tool items (stream=%s)",
    async (stream) => {
      const create = vi.fn(async () => (stream ? events() : response));
      const model = new AzureOpenAIClient({
        client: { responses: { create } } as never,
      }).completionModel({ modelId: "deployment", api: "responses" });
      if (stream) {
        const output = [];
        for await (const event of model.streamCompletion(request)) output.push(event);
        expect(output).toHaveLength(1);
      } else {
        await model.completion(request);
      }
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "deployment",
          ...(stream ? { stream: true } : {}),
          input: [
            { type: "message", role: "user", content: "Weather?" },
            { type: "message", role: "assistant", content: "Checking." },
            {
              type: "function_call",
              id: "item_1",
              call_id: "call_1",
              name: "weather",
              arguments: "{}",
            },
            { type: "function_call_output", call_id: "call_1", output: "Sunny" },
          ],
        }),
        expect.anything(),
      );
      expect(request.chatHistory[0]).not.toHaveProperty("type");
    },
  );

  it("leaves OpenAI's native request mapping unchanged", async () => {
    const create = vi.fn(async () => response);
    const model = new OpenAIClient({ client: { responses: { create } } as never }).completionModel({
      modelId: "gpt-5.1",
      api: "responses",
    });
    await model.completion(request);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.arrayContaining([{ role: "user", content: "Weather?" }]),
      }),
      expect.anything(),
    );
  });
});

async function* events() {
  yield { type: "response.completed", response };
}
