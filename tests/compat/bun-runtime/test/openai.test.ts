import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { generateCompletion, streamCompletion } from "@anvia/core/completion";
import { generateImage } from "@anvia/core/image-generation";
import { generateSpeech } from "@anvia/core/speech-generation";
import { transcribe } from "@anvia/core/transcription";
import { OpenAIClient } from "@anvia/openai";

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
    } else if (contentType?.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      recorded.body = {
        fileName: file instanceof File ? file.name : undefined,
        language: form.get("language"),
        model: form.get("model"),
      };
    }
    requests.push(recorded);
    const body = isRecord(recorded.body) ? recorded.body : {};

    if (url.pathname === "/v1/chat/completions") {
      return json({
        id: "chatcmpl_bun",
        object: "chat.completion",
        created: 1_700_000_000,
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from OpenAI on Bun" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 5, total_tokens: 7 },
      });
    }

    if (url.pathname === "/v1/responses") {
      if (body.model === "slow-model") {
        resolveSlowRequest?.();
        return new Response(new ReadableStream(), {
          headers: { "content-type": "application/json" },
        });
      }
      const response = responsesPayload();
      return body.stream === true
        ? eventStream([
            { type: "response.output_text.delta", delta: "Hello from " },
            { type: "response.output_text.delta", delta: "Responses on Bun" },
            { type: "response.completed", response },
          ])
        : json(response);
    }

    if (url.pathname === "/v1/embeddings") {
      return json({
        object: "list",
        model: "text-embedding-3-small",
        data: [
          { object: "embedding", index: 0, embedding: "AACAPwAAAAA=" },
          { object: "embedding", index: 1, embedding: "AAAAAAAAgD8=" },
        ],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      });
    }

    if (url.pathname === "/v1/images/generations") {
      return json({ output_format: "png", data: [{ b64_json: "AQID" }] });
    }

    if (url.pathname === "/v1/audio/speech") {
      return new Response(new Uint8Array([4, 5, 6]), {
        headers: { "content-type": "audio/wav" },
      });
    }

    if (url.pathname === "/v1/audio/transcriptions") {
      return json({ text: "Bun heard this" });
    }

    if (url.pathname === "/v1/models") {
      return json({
        object: "list",
        data: [
          {
            id: "gpt-4o-mini",
            object: "model",
            created: 1_700_000_000,
            owned_by: "openai",
          },
        ],
        has_more: false,
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

const client = new OpenAIClient({
  apiKey: "bun-compat-test-key",
  baseUrl: new URL("/v1", server.url).toString().replace(/\/$/, ""),
});

beforeEach(() => {
  requests.length = 0;
  resetSlowRequest();
});

afterAll(() => {
  server.stop(true);
});

describe("@anvia/openai under Bun", () => {
  it("uses Bun fetch for chat completions", async () => {
    const model = client.completionModel({ modelId: "gpt-4o-mini", api: "chat" });

    const completion = await generateCompletion({ model, prompt: "hello" });

    expect(completion.text).toBe("Hello from OpenAI on Bun");
    expect(completion.usage).toMatchObject({ inputTokens: 2, outputTokens: 5, totalTokens: 7 });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        pathname: "/v1/chat/completions",
        body: expect.objectContaining({ model: "gpt-4o-mini" }),
      }),
    ]);
  });

  it("uses Bun fetch for Responses completions", async () => {
    const model = client.completionModel({ modelId: "gpt-4o-mini", api: "responses" });

    const completion = await generateCompletion({ model, prompt: "hello" });

    expect(completion.text).toBe("Hello from Responses on Bun");
    expect(completion.usage).toMatchObject({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1/responses",
      body: expect.objectContaining({ model: "gpt-4o-mini" }),
    });
  });

  it("parses chunked Responses SSE streams", async () => {
    const model = client.completionModel({ modelId: "gpt-4o-mini", api: "responses" });

    const events = await collect(streamCompletion({ model, prompt: "hello" }));

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello from " },
      { type: "text_delta", delta: "Responses on Bun" },
      expect.objectContaining({
        type: "final",
        result: expect.objectContaining({ text: "Hello from Responses on Bun" }),
      }),
    ]);
    expect(requests[0]).toMatchObject({
      pathname: "/v1/responses",
      body: expect.objectContaining({ stream: true }),
    });
  });

  it("propagates AbortSignal cancellation through Bun fetch", async () => {
    const model = client.completionModel({ modelId: "slow-model", api: "responses" });
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

  it("maps embeddings returned through Bun fetch", async () => {
    const model = client.embeddingModel({ modelId: "text-embedding-3-small" });

    await expect(model.embedTexts(["one", "two"])).resolves.toEqual([
      { document: "one", vector: [1, 0] },
      { document: "two", vector: [0, 1] },
    ]);
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1/embeddings",
      body: expect.objectContaining({ input: ["one", "two"], encoding_format: "base64" }),
    });
  });

  it("decodes base64 image responses", async () => {
    const model = client.imageGenerationModel({ modelId: "gpt-image-1" });

    const result = await generateImage({ model, prompt: "draw a bun" });

    expect(result.images).toEqual([{ data: new Uint8Array([1, 2, 3]), mediaType: "image/png" }]);
    expect(requests[0]).toMatchObject({ method: "POST", pathname: "/v1/images/generations" });
  });

  it("uploads transcription audio as multipart form data", async () => {
    const model = client.transcriptionModel({ modelId: "whisper-1" });

    const result = await transcribe({
      model,
      audio: {
        data: new Uint8Array([1, 2, 3]),
        filename: "sample.wav",
        mediaType: "audio/wav",
      },
      language: "en",
    });

    expect(result.text).toBe("Bun heard this");
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1/audio/transcriptions",
      contentType: expect.stringContaining("multipart/form-data; boundary="),
      body: { fileName: "sample.wav", language: "en", model: "whisper-1" },
    });
  });

  it("reads binary speech responses", async () => {
    const model = client.speechGenerationModel({ modelId: "tts-1" });

    const result = await generateSpeech({
      model,
      text: "hello",
      voice: "alloy",
      providerOptions: { response_format: "wav" },
    });

    expect(result.audio).toEqual({ data: new Uint8Array([4, 5, 6]), mediaType: "audio/wav" });
    expect(requests[0]).toMatchObject({
      method: "POST",
      pathname: "/v1/audio/speech",
      body: expect.objectContaining({ response_format: "wav" }),
    });
  });

  it("iterates models returned by the OpenAI SDK", async () => {
    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "gpt-4o-mini",
          type: "model",
          createdAt: 1_700_000_000,
          ownedBy: "openai",
        },
      ],
    });
    expect(requests[0]).toMatchObject({ method: "GET", pathname: "/v1/models" });
  });
});

function json(value: unknown): Response {
  return Response.json(value);
}

function responsesPayload() {
  return {
    id: "resp_bun",
    object: "response",
    created_at: 1_700_000_000,
    status: "completed",
    model: "gpt-4o-mini",
    output: [
      {
        id: "msg_bun",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello from Responses on Bun", annotations: [] }],
      },
    ],
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
  };
}

function eventStream(events: readonly unknown[]): Response {
  const chunks = [
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    "data: [DONE]\n\n",
  ];
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        const chunk = chunks[index];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        index += 1;
        controller.enqueue(encoder.encode(chunk));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function resetSlowRequest(): void {
  slowRequestStarted = new Promise((resolve) => {
    resolveSlowRequest = resolve;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const event of events) values.push(event);
  return values;
}
