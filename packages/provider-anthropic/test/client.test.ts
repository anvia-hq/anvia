import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import {
  AnthropicClient,
  type AnthropicClientOptions,
  type AnthropicCompletionModelId,
  AnthropicVertexClient,
} from "../src/index";

describe("Anthropic client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects mixed injected and managed configuration", () => {
    const mixed = { client: {} as never, baseUrl: "https://example.com" };
    expectTypeOf(mixed).not.toMatchTypeOf<AnthropicClientOptions>();
    expect(() => new AnthropicClient(mixed as never)).toThrow(
      "AnthropicClient cannot combine client with baseUrl",
    );

    expect(
      () => new AnthropicVertexClient({ client: {} as never, region: "global" } as never),
    ).toThrow("AnthropicVertexClient cannot combine client with region");
  });

  it("types known Anthropic models while accepting custom model strings", () => {
    const anthropic = new AnthropicClient({
      client: { messages: { create: async () => ({}) } } as never,
    });

    expectTypeOf(
      anthropic.completionModel({ modelId: "claude-sonnet-4-20250514" }).modelId,
    ).toEqualTypeOf<string>();
    expectTypeOf("claude-sonnet-4-20250514").toMatchTypeOf<AnthropicCompletionModelId>();
    const reasoningModel = anthropic.completionModel({ modelId: "claude-sonnet-4-6" });
    expectTypeOf(reasoningModel.controls!.reasoningEffort.options).items.toEqualTypeOf<
      "low" | "medium" | "high" | "max"
    >();
    const mythosPreview = anthropic.completionModel({ modelId: "claude-mythos-preview" });
    expectTypeOf(mythosPreview.controls!.reasoningEffort.options).items.toEqualTypeOf<
      "low" | "medium" | "high" | "max"
    >();
    anthropic.completionModel({ modelId: "custom-messages-model" });
  });

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
    const model = anthropic.completionModel({ modelId: "custom-messages-model" });

    expect(model.modelId).toBe("custom-messages-model");
    await model.completion({
      chatHistory: [Message.user("hello")],
      documents: [],
      tools: [],
    });
    expect(calls).toEqual([
      {
        model: "custom-messages-model",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hello" }],
      },
    ]);
  });

  it("creates an Anthropic Vertex client with explicit routing and authentication", () => {
    const anthropic = new AnthropicVertexClient({
      projectId: "project",
      region: "global",
      authClient: {} as never,
    });

    expectTypeOf(anthropic).not.toHaveProperty("client");
    expect(anthropic.completionModel({ modelId: "claude-sonnet-5" }).modelId).toBe(
      "claude-sonnet-5",
    );
    anthropic.completionModel({ modelId: "claude-sonnet-4-5@20250929" });
  });

  it("allows the Anthropic Vertex SDK to resolve project and region from the environment", () => {
    vi.stubEnv("ANTHROPIC_VERTEX_PROJECT_ID", "environment-project");
    vi.stubEnv("CLOUD_ML_REGION", "us");

    const anthropic = new AnthropicVertexClient({
      authClient: {} as never,
    });

    expect(anthropic.completionModel({ modelId: "claude-sonnet-5" }).modelId).toBe(
      "claude-sonnet-5",
    );
  });

  it("uses an injected Anthropic Vertex Messages client for completions and streams", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const anthropic = new AnthropicVertexClient({
      client: {
        messages: {
          create: async (params: Record<string, unknown>) => {
            calls.push(params);
            if (params.stream === true) {
              return asyncIterable([
                { type: "message_start", message: { id: "msg_stream" } },
                {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: "streamed" },
                },
                {
                  type: "message_stop",
                  message: {
                    id: "msg_stream",
                    content: [{ type: "text", text: "streamed" }],
                  },
                },
              ]);
            }
            return {
              id: "msg_completion",
              content: [{ type: "text", text: "completed" }],
              usage: {},
            };
          },
        },
      } as never,
    });
    const model = anthropic.completionModel({ modelId: "claude-sonnet-5" });
    const request = {
      chatHistory: [Message.user("hello")],
      documents: [],
      tools: [],
    };

    await expect(model.completion(request)).resolves.toMatchObject({
      messageId: "msg_completion",
    });
    const events = [];
    for await (const event of model.streamCompletion(request)) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "final",
      response: { messageId: "msg_stream" },
    });
    expect(calls).toEqual([
      expect.objectContaining({ model: "claude-sonnet-5" }),
      expect.objectContaining({ model: "claude-sonnet-5", stream: true }),
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

  it("preserves model field precedence across compatible aliases", async () => {
    const anthropic = new AnthropicClient({
      client: {
        models: {
          list: async () =>
            asyncIterable([
              {
                id: "claude-compatible",
                display_name: "Display Name",
                name: "Preferred Name",
                max_input_tokens: 100_000,
                context_length: 200_000,
              },
            ]),
        },
      } as never,
    });

    await expect(anthropic.listModels()).resolves.toEqual({
      data: [
        {
          id: "claude-compatible",
          name: "Preferred Name",
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
