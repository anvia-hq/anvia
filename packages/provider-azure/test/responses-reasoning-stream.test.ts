import {
  COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
  streamCompletion,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import { OpenAIClient } from "@anvia/openai";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { AzureOpenAIClient } from "../src/index";

describe.each(["azure", "openai"] as const)(
  "%s Responses reasoning SSE compatibility",
  (provider) => {
    it.each(
      [false, true].flatMap((encrypted) =>
        (["none", "summary", "text"] as const).map((emptyDetail) => ({ encrypted, emptyDetail })),
      ),
    )(
      "retains final-only reasoning (encrypted=$encrypted, emptyDetail=$emptyDetail)",
      async ({ encrypted, emptyDetail }) => {
        const reasoning = reasoningItem(encrypted, emptyDetail);
        const details = [
          ...(emptyDetail === "none" ? [] : [{ type: emptyDetail, text: "" }]),
          ...(encrypted ? [{ type: "encrypted", data: "opaque-reasoning" }] : []),
        ];
        const { model, fetch } = modelWithSSE(provider, responseStream(reasoning));
        const events = await collectEvents(
          streamCompletion({
            model,
            prompt: "Say OK.",
            providerOptions: { reasoning: { effort: "max" } },
          }),
        );
        const final = events.find((event) => event.type === "final");

        expect(events.filter((event) => event.type === "error")).toEqual([]);
        expect(events.filter((event) => event.type === "text_delta")).toEqual([
          { type: "text_delta", delta: "OK" },
        ]);
        expect(final?.result).toMatchObject({
          output: "OK",
          content: [
            {
              type: "reasoning",
              id: "rs-1",
              text: "",
              ...(details.length > 0 ? { details } : {}),
            },
            { type: "text", text: "OK" },
          ],
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          finishReason: "stop",
          rawResponse: { id: "resp-1", output: [reasoning, expect.anything()] },
        });
        expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({
          stream: true,
          reasoning: { effort: "max" },
        });

        // Replay the assembled choice through the adapter to preserve reasoning across turns.
        expect(final).toBeDefined();
        if (final?.type !== "final") throw new Error("Expected a final completion");
        fetch.mockImplementationOnce(
          async () =>
            new Response(
              JSON.stringify({ id: "resp-2", status: "completed", output: [], usage: {} }),
              {
                headers: { "content-type": "application/json" },
              },
            ),
        );
        await model.completion({
          chatHistory: [Message.assistant(final.result.content), Message.user("Continue.")],
          documents: [],
          tools: [],
        });
        expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string).input).toContainEqual(reasoning);
      },
    );

    it.each([false, true])(
      "retains streamed reasoning without duplication (encrypted=%s)",
      async (encrypted) => {
        const reasoning = {
          ...reasoningItem(encrypted),
          summary: [{ type: "summary_text", text: "Thinking." }],
        };
        const { model } = modelWithSSE(
          provider,
          responseStream(reasoning, { summary: "Thinking." }),
        );
        const events = await collectEvents(
          streamCompletion({
            model,
            prompt: "Say OK.",
            providerOptions: { reasoning: { effort: "max" } },
          }),
        );
        const final = events.find((event) => event.type === "final");

        expect(events.filter((event) => event.type === "error")).toEqual([]);
        expect(events.filter((event) => event.type === "reasoning_delta")).toEqual([
          { type: "reasoning_delta", id: "rs-1", contentType: "summary", delta: "Thinking." },
        ]);
        expect(final?.result.content).toEqual([
          {
            type: "reasoning",
            id: "rs-1",
            text: "Thinking.",
            details: [
              { type: "summary", text: "Thinking." },
              ...(encrypted ? [{ type: "encrypted", data: "opaque-reasoning" }] : []),
            ],
          },
          { type: "text", text: "OK" },
        ]);
      },
    );

    it("rejects conflicting final text even with final-only encrypted reasoning", async () => {
      const { model } = modelWithSSE(provider, responseStream(reasoningItem(true), { text: "NO" }));
      const events = await collectEvents(
        streamCompletion({
          model,
          prompt: "Say OK.",
          providerOptions: { reasoning: { effort: "max" } },
        }),
      );

      expect(events.find((event) => event.type === "final")).toBeUndefined();
      expect(events.find((event) => event.type === "error")).toMatchObject({
        error: {
          name: "CompletionProviderOutputError",
          code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
          kind: "invalid-stream-event",
        },
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      });
    });
  },
);

function reasoningItem(encrypted: boolean, emptyDetail: "none" | "summary" | "text" = "none") {
  return {
    id: "rs-1",
    type: "reasoning",
    summary: emptyDetail === "summary" ? [{ type: "summary_text", text: "" }] : [],
    ...(emptyDetail === "text" ? { content: [{ type: "reasoning_text", text: "" }] } : {}),
    ...(encrypted ? { encrypted_content: "opaque-reasoning" } : {}),
  };
}

function responseStream(reasoning: unknown, options: { summary?: string; text?: string } = {}) {
  return [
    ...(options.summary === undefined
      ? []
      : [
          {
            type: "response.reasoning_summary_text.delta",
            item_id: "rs-1",
            delta: options.summary,
          },
        ]),
    {
      type: "response.output_text.delta",
      delta: "OK",
      item_id: "msg-1",
      output_index: 1,
      content_index: 0,
    },
    {
      type: "response.completed",
      response: {
        id: "resp-1",
        status: "completed",
        output: [
          reasoning,
          {
            id: "msg-1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: options.text ?? "OK", annotations: [] }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      },
    },
  ];
}

function modelWithSSE(provider: "azure" | "openai", events: unknown[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      }),
  );
  const client =
    provider === "azure"
      ? new AzureOpenAIClient({
          endpoint: "https://test.openai.azure.com",
          apiKey: "test-key",
          fetch,
        })
      : new OpenAIClient({ client: new OpenAI({ apiKey: "test-key", fetch, maxRetries: 0 }) });
  const model: StreamingCompletionModel = client.completionModel({
    modelId: "responses-test",
    api: "responses",
  });
  return { model, fetch };
}

async function collectEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}
