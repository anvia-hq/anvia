import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { generateCompletion, streamCompletion } from "@anvia/core/completion";
import { GeminiClient } from "@anvia/gemini";
import { GoogleGenAI } from "@google/genai";

type RecordedRequest = {
  method: string;
  pathname: string;
  body?: unknown;
  contentType?: string | undefined;
};

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

    if (url.pathname === "/v1beta/models/gemini-2.5-flash:generateContent") {
      return Response.json(generateContentPayload());
    }

    if (url.pathname === "/v1beta/models/gemini-2.5-flash:streamGenerateContent") {
      // Real Gemini streams end with a finishReason-only terminal chunk; the
      // terminal chunk must not restate content that diverges from the deltas.
      return eventStream([
        {
          candidates: [{ content: { parts: [{ text: "Hello from " }], role: "model" }, index: 0 }],
        },
        {
          candidates: [
            { content: { parts: [{ text: "Gemini on Bun" }], role: "model" }, index: 0 },
          ],
        },
        {
          candidates: [{ finishReason: "STOP", index: 0 }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 5, totalTokenCount: 7 },
          modelVersion: "gemini-2.5-flash",
          responseId: "bun-gemini",
        },
      ]);
    }

    if (url.pathname === "/v1beta/models/slow-model:generateContent") {
      resolveSlowRequest?.();
      return new Response(new ReadableStream(), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/v1beta/models/error-model:generateContent") {
      return Response.json(
        {
          error: {
            code: 400,
            message: "Bun fixture rejected this request",
            status: "INVALID_ARGUMENT",
          },
        },
        { status: 400 },
      );
    }

    return new Response("Not found", { status: 404 });
  },
});

const client = new GeminiClient({
  client: new GoogleGenAI({
    apiKey: "bun-compat-test-key",
    httpOptions: { baseUrl: new URL(server.url).origin },
  }),
});

beforeEach(() => {
  requests.length = 0;
  resetSlowRequest();
});

afterAll(() => {
  server.stop(true);
});

describe("@anvia/gemini under Bun", () => {
  it("uses Bun fetch for generateContent completions", async () => {
    const model = client.completionModel({ modelId: "gemini-2.5-flash" });

    const completion = await generateCompletion({ model, prompt: "hello" });

    expect(completion.text).toBe("Hello from Gemini on Bun");
    expect(completion.usage).toMatchObject({ inputTokens: 2, outputTokens: 5, totalTokens: 7 });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        pathname: "/v1beta/models/gemini-2.5-flash:generateContent",
        body: expect.objectContaining({
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
        }),
      }),
    ]);
  });

  it("parses chunked streamGenerateContent SSE streams", async () => {
    const model = client.completionModel({ modelId: "gemini-2.5-flash" });

    const events = await collect(streamCompletion({ model, prompt: "hello" }));

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello from " },
      { type: "text_delta", delta: "Gemini on Bun" },
      { type: "message_id", id: "bun-gemini" },
      expect.objectContaining({
        type: "final",
        result: expect.objectContaining({
          text: "Hello from Gemini on Bun",
          usage: expect.objectContaining({ inputTokens: 2, outputTokens: 5, totalTokens: 7 }),
        }),
      }),
    ]);
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1beta/models/gemini-2.5-flash:streamGenerateContent",
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
      name: "ApiError",
      status: 400,
      message: expect.stringContaining("Bun fixture rejected this request"),
    });
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1beta/models/error-model:generateContent",
    });
  });
});

function generateContentPayload() {
  return {
    candidates: [
      {
        content: { parts: [{ text: "Hello from Gemini on Bun" }], role: "model" },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 5, totalTokenCount: 7 },
    modelVersion: "gemini-2.5-flash",
    responseId: "bun-gemini",
  };
}

function eventStream(events: readonly unknown[]): Response {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
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
