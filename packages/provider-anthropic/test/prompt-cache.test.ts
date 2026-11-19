import type { CompletionRequest } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { AssistantContent, Message } from "../../core/test/helpers/imports";
import { toAnthropicMessagesParams } from "../src/anthropic/completion";
import {
  anthropicPromptCacheOptions,
  withAnthropicPromptCache,
} from "../src/anthropic/prompt-cache";
import { AnthropicClient, withAnthropicPromptCache as exported } from "../src/index";

const EPHEMERAL = { type: "ephemeral" };

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    chatHistory: [Message.user("hello")],
    documents: [],
    tools: [],
    ...overrides,
  };
}

describe("Anthropic prompt cache", () => {
  it("is exported from the package entrypoint", () => {
    expect(exported).toBe(withAnthropicPromptCache);
  });

  it("marks the last tool, the system prompt and the last message", () => {
    const params = toAnthropicMessagesParams(
      "claude-sonnet-5",
      request({
        instructions: "Be brief.",
        chatHistory: [Message.user("hi"), Message.user("and again")],
        tools: [
          { name: "add", description: "Add numbers", parameters: { type: "object" } },
          { name: "mul", description: "Multiply numbers", parameters: { type: "object" } },
        ],
      }),
      {},
    );

    expect(params.system).toEqual([{ type: "text", text: "Be brief.", cache_control: EPHEMERAL }]);
    expect(params.tools).toEqual([
      { name: "add", description: "Add numbers", input_schema: { type: "object" } },
      {
        name: "mul",
        description: "Multiply numbers",
        input_schema: { type: "object" },
        cache_control: EPHEMERAL,
      },
    ]);
    expect(params.messages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "user",
        content: [{ type: "text", text: "and again", cache_control: EPHEMERAL }],
      },
    ]);
  });

  it("leaves params untouched when the model does not enable caching", () => {
    const params = toAnthropicMessagesParams(
      "claude-sonnet-5",
      request({ instructions: "Be brief." }),
    );

    expect(params.system).toBe("Be brief.");
    expect(params.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("supports the one-hour cache TTL", () => {
    const params = toAnthropicMessagesParams(
      "claude-sonnet-5",
      request({ instructions: "Be brief." }),
      { ttl: "1h" },
    );

    expect(params.system).toEqual([
      { type: "text", text: "Be brief.", cache_control: { type: "ephemeral", ttl: "1h" } },
    ]);
  });

  it("rejects an unknown TTL before the provider call", () => {
    expect(() =>
      toAnthropicMessagesParams("claude-sonnet-5", request(), { ttl: "2h" } as never),
    ).toThrow('Anthropic prompt cache ttl must be "5m" or "1h".');
    expect(() =>
      new AnthropicClient({ client: {} as never }).completionModel({
        modelId: "claude-sonnet-5",
        promptCache: { ttl: "2h" } as never,
      }),
    ).toThrow('Anthropic prompt cache ttl must be "5m" or "1h".');
  });

  it("caches the last tool result instead of a thinking block", () => {
    const params = toAnthropicMessagesParams(
      "claude-sonnet-5",
      request({
        chatHistory: [
          Message.user("What is 2+5?"),
          Message.assistant([
            AssistantContent.reasoningFromContent([{ type: "text", text: "Add.", signature: "s" }]),
            AssistantContent.toolCall("toolu_1", "add", { x: 2, y: 5 }),
          ]),
          Message.tool([
            { type: "tool_result", id: "toolu_1", content: [{ type: "text", text: "7" }] },
          ]),
        ],
      }),
      {},
    );

    expect(params.messages).toEqual([
      { role: "user", content: "What is 2+5?" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Add.", signature: "s" },
          { type: "tool_use", id: "toolu_1", name: "add", input: { x: 2, y: 5 } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "7", cache_control: EPHEMERAL },
        ],
      },
    ]);
  });

  it("falls back to an earlier message when the last one holds only thinking", () => {
    const params = toAnthropicMessagesParams(
      "claude-sonnet-5",
      request({
        chatHistory: [
          Message.user("Think first"),
          Message.assistant([
            AssistantContent.reasoningFromContent([{ type: "text", text: "Hm.", signature: "s" }]),
          ]),
        ],
      }),
      {},
    );

    expect(params.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Think first", cache_control: EPHEMERAL }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "Hm.", signature: "s" }] },
    ]);
  });

  it("keeps existing breakpoints and stays within four of them", () => {
    const params = {
      tools: [{ name: "add", cache_control: EPHEMERAL }],
      system: [{ type: "text", text: "Be brief.", cache_control: EPHEMERAL }],
      messages: [
        { role: "user", content: [{ type: "text", text: "a", cache_control: EPHEMERAL }] },
        { role: "user", content: [{ type: "text", text: "b", cache_control: EPHEMERAL }] },
        { role: "user", content: [{ type: "text", text: "c" }] },
      ],
    };

    const cached = withAnthropicPromptCache(params);

    expect(cached).toEqual(params);
    expect(cached.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "a", cache_control: EPHEMERAL }] },
      { role: "user", content: [{ type: "text", text: "b", cache_control: EPHEMERAL }] },
      { role: "user", content: [{ type: "text", text: "c" }] },
    ]);
  });

  it("does not mutate the params it receives", () => {
    const tools = [{ name: "add", input_schema: { type: "object" } }];
    const messages = [{ role: "user", content: "hello" }];

    withAnthropicPromptCache({ tools, messages });

    expect(tools).toEqual([{ name: "add", input_schema: { type: "object" } }]);
    expect(messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("sends cache breakpoints for a model with promptCache enabled", async () => {
    const calls: unknown[] = [];
    const client = {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return { id: "msg_1", content: [{ type: "text", text: "ok" }], usage: {} };
        },
      },
    };

    const model = new AnthropicClient({ client: client as never }).completionModel({
      modelId: "claude-sonnet-5",
      promptCache: true,
    });
    await model.completion(request({ instructions: "Be brief." }));

    expect(calls).toEqual([
      {
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: [{ type: "text", text: "Be brief.", cache_control: EPHEMERAL }],
        messages: [
          { role: "user", content: [{ type: "text", text: "hello", cache_control: EPHEMERAL }] },
        ],
      },
    ]);
  });

  it("reports a cached system prompt in the request trace", () => {
    const model = new AnthropicClient({ client: {} as never }).completionModel({
      modelId: "claude-sonnet-5",
      promptCache: true,
    });

    expect(model.traceRequest?.(request({ instructions: "Be brief." }))).toMatchObject({
      hasSystem: true,
      parameterKeys: ["max_tokens", "messages", "model", "system"],
    });
  });

  it("normalizes the model-level setting", () => {
    expect(anthropicPromptCacheOptions(undefined)).toBeUndefined();
    expect(anthropicPromptCacheOptions(false)).toBeUndefined();
    expect(anthropicPromptCacheOptions(true)).toEqual({});
    expect(anthropicPromptCacheOptions({ ttl: "1h" })).toEqual({ ttl: "1h" });
  });
});
