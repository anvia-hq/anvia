import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { generateCompletion, streamCompletion } from "@anvia/core/completion";
import { MistralClient } from "@anvia/mistral";

type RecordedRequest = {
  method: string;
  pathname: string;
  body?: unknown;
  contentType?: string | undefined;
};

type ChatCompletionsFixtureBody = { model?: string; stream?: boolean };

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
    const body = (recorded.body ?? {}) as ChatCompletionsFixtureBody;

    if (url.pathname === "/v1/chat/completions") {
      if (body.model === "slow-model") {
        resolveSlowRequest?.();
        return new Response(new ReadableStream(), {
          headers: { "content-type": "application/json" },
        });
      }

      if (body.model === "error-model") {
        return Response.json(
          {
            message: "Bun fixture rejected this request",
            type: "invalid_request_error",
            param: null,
            code: null,
          },
          { status: 400 },
        );
      }

      if (body.stream === true) {
        return eventStream([
          {
            id: "bun-mistral",
            object: "chat.completion.chunk",
            created: 1_700_000_000,
            model: "mistral-small-latest",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Hello from " },
                finish_reason: null,
              },
            ],
          },
          {
            id: "bun-mistral",
            object: "chat.completion.chunk",
            created: 1_700_000_000,
            model: "mistral-small-latest",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Mistral on Bun" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "bun-mistral",
            object: "chat.completion.chunk",
            created: 1_700_000_000,
            model: "mistral-small-latest",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 2, completion_tokens: 5, total_tokens: 7 },
          },
        ]);
      }

      return Response.json({
        id: "bun-mistral",
        object: "chat.completion",
        created: 1_700_000_000,
        model: "mistral-small-latest",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from Mistral on Bun" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 5, total_tokens: 7 },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

const client = new MistralClient({
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

describe("@anvia/mistral under Bun", () => {
  it("uses Bun fetch for chat completions", async () => {
    const model = client.completionModel({ modelId: "mistral-small-latest" });

    const completion = await generateCompletion({ model, prompt: "hello" });

    expect(completion.text).toBe("Hello from Mistral on Bun");
    expect(completion.usage).toMatchObject({ inputTokens: 2, outputTokens: 5, totalTokens: 7 });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        pathname: "/v1/chat/completions",
        body: {
          model: "mistral-small-latest",
          stream: false,
          messages: [{ role: "user", content: "hello" }],
        },
      }),
    ]);
  });

  it("parses chunked chat SSE streams", async () => {
    const model = client.completionModel({ modelId: "mistral-small-latest" });

    const events = await collect(streamCompletion({ model, prompt: "hello" }));

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello from " },
      { type: "message_id", id: "bun-mistral" },
      { type: "text_delta", delta: "Mistral on Bun" },
      { type: "message_id", id: "bun-mistral" },
      { type: "message_id", id: "bun-mistral" },
      expect.objectContaining({
        type: "final",
        result: expect.objectContaining({
          text: "Hello from Mistral on Bun",
          usage: expect.objectContaining({ inputTokens: 2, outputTokens: 5, totalTokens: 7 }),
        }),
      }),
    ]);
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1/chat/completions",
      body: expect.objectContaining({ model: "mistral-small-latest", stream: true }),
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

    const completion = generateCompletion({ model, prompt: "hello" });

    await expect(completion).rejects.toMatchObject({
      name: "SDKError",
      statusCode: 400,
      message: expect.stringContaining("Bun fixture rejected this request"),
    });
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1/chat/completions",
      body: expect.objectContaining({ model: "error-model" }),
    });
  });
});

function eventStream(events: readonly unknown[]): Response {
  const frames = [
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    "data: [DONE]\n\n",
  ];
  return fragmentedStream(frames.join(""));
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
