import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { generateCompletion, streamCompletion } from "@anvia/core/completion";
import { AnthropicClient } from "@anvia/anthropic";
import { BadRequestError } from "@anthropic-ai/sdk";

type RecordedRequest = {
  method: string;
  pathname: string;
  body?: unknown;
  contentType?: string | undefined;
};

type MessagesFixtureBody = { model?: string; stream?: boolean };

const requests: RecordedRequest[] = [];
let resolveSlowRequest: (() => void) | undefined;
let slowRequestStarted = Promise.resolve();

resetSlowRequest();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const contentType = request.headers.get("content-type") ?? undefined;
    const recorded: RecordedRequest = {
      method: request.method,
      pathname: url.pathname,
      contentType,
    };

    if (contentType?.startsWith("application/json")) {
      recorded.body = await request.json();
    }
    requests.push(recorded);
    const body = (recorded.body ?? {}) as MessagesFixtureBody;

    if (url.pathname === "/v1/messages") {
      if (body.model === "slow-model") {
        resolveSlowRequest?.();
        return new Response(new ReadableStream(), {
          headers: { "content-type": "application/json" },
        });
      }

      if (body.model === "error-model") {
        return Response.json(
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "Bun fixture rejected this request",
            },
          },
          { status: 400 },
        );
      }

      if (body.stream === true) {
        return eventStream([
          {
            type: "message_start",
            message: { id: "msg_bun", role: "assistant", usage: { input_tokens: 3 } },
          },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Hello from " },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Anthropic on Bun" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 6 },
          },
          { type: "message_stop" },
        ]);
      }

      return Response.json({
        id: "msg_bun",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: "Hello from Anthropic on Bun" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 5 },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

const client = new AnthropicClient({
  apiKey: "bun-compat-test-key",
  baseUrl: new URL(server.url).origin,
});

beforeEach(() => {
  requests.length = 0;
  resetSlowRequest();
});

afterAll(() => {
  server.stop(true);
});

describe("@anvia/anthropic under Bun", () => {
  it("uses Bun fetch for Messages completions", async () => {
    const model = client.completionModel({ modelId: "claude-haiku-4-5" });

    const completion = await generateCompletion({ model, prompt: "hello" });

    expect(completion.text).toBe("Hello from Anthropic on Bun");
    expect(completion.usage).toMatchObject({ inputTokens: 2, outputTokens: 5, totalTokens: 7 });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        pathname: "/v1/messages",
        body: {
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          messages: [{ role: "user", content: "hello" }],
        },
      }),
    ]);
  });

  it("parses chunked Messages SSE streams", async () => {
    const model = client.completionModel({ modelId: "claude-haiku-4-5" });

    const events = await collect(streamCompletion({ model, prompt: "hello" }));

    expect(events).toEqual([
      { type: "message_id", id: "msg_bun" },
      { type: "text_delta", delta: "Hello from " },
      { type: "text_delta", delta: "Anthropic on Bun" },
      expect.objectContaining({
        type: "final",
        result: expect.objectContaining({
          text: "Hello from Anthropic on Bun",
          usage: expect.objectContaining({ inputTokens: 3, outputTokens: 6, totalTokens: 9 }),
        }),
      }),
    ]);
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1/messages",
      body: expect.objectContaining({ model: "claude-haiku-4-5", stream: true }),
    });
  });

  it("propagates AbortSignal cancellation through Bun fetch", async () => {
    const model = client.completionModel({ modelId: "slow-model" });
    const controller = new AbortController();
    const completion = generateCompletion({
      model,
      prompt: "wait",
      abortSignal: controller.signal,
    });
    await slowRequestStarted;

    controller.abort("caller stopped");

    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
  });

  it("surfaces vendor SDK errors for HTTP failures", async () => {
    const model = client.completionModel({ modelId: "error-model" });

    const error = await generateCompletion({ model, prompt: "hello" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error).toMatchObject({
      status: 400,
      message: expect.stringContaining("Bun fixture rejected this request"),
    });
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1/messages",
      body: expect.objectContaining({ model: "error-model" }),
    });
  });
});

function eventStream(events: readonly ({ type: string } & Record<string, unknown>)[]): Response {
  const payload = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return fragmentedStream(payload);
}

function fragmentedStream(payload: string, pieceSize = 13): Response {
  const bytes = new TextEncoder().encode(payload);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + pieceSize, bytes.length);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function resetSlowRequest(): void {
  ({ promise: slowRequestStarted, resolve: resolveSlowRequest } = Promise.withResolvers<void>());
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const event of events) values.push(event);
  return values;
}
