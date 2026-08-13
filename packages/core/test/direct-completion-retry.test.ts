import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AssistantContent,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  createCompletion,
  createCompletionStream,
  createParsedCompletion,
  type StreamingCompletionModel,
  Usage,
} from "./helpers/imports";

const capabilities: CompletionModelCapabilities = {
  streaming: true,
  tools: true,
  toolChoice: true,
  imageInput: true,
  documentInput: true,
  outputSchema: true,
  reasoning: true,
};

describe("direct completion retries", () => {
  it("retries transient completion failures with the shared policy", async () => {
    const error = Object.assign(new Error("unavailable"), { status: 503 });
    const model = new CompletionQueueModel([error, response("recovered")]);
    const contexts: unknown[] = [];

    const result = await createCompletion("hello", {
      model,
      retries: {
        maxAttempts: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry(context) {
          contexts.push(context);
          return true;
        },
      },
    });

    expect(result.text).toBe("recovered");
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]).toBe(model.requests[0]);
    expect(contexts).toEqual([{ error, attempt: 1, maxAttempts: 2, streaming: false }]);
  });

  it("does not retry parsed-output validation failures", async () => {
    const model = new CompletionQueueModel([response("not json"), response('{"ok":true}')]);

    await expect(
      createParsedCompletion("hello", {
        model,
        schema: z.object({ ok: z.boolean() }),
        retries: { initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toThrow("valid JSON");
    expect(model.requests).toHaveLength(1);
  });

  it("retries a stream error before exposing events and aggregates usage", async () => {
    const error = Object.assign(new Error("unavailable"), { statusCode: 503 });
    const failedUsage = usage(4, 1);
    const finalUsage = usage(6, 3);
    const model = new StreamQueueModel([
      [{ type: "error", error, usage: failedUsage }],
      [{ type: "final", response: response("ready", finalUsage) }],
    ]);

    const events = await collect(
      createCompletionStream("hello", {
        model,
        retries: { initialDelayMs: 0, maxDelayMs: 0 },
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "final",
      response: { usage: Usage.add(failedUsage, finalUsage) },
    });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]).toBe(model.requests[0]);
  });

  it("never retries after a stream event has been exposed", async () => {
    const error = Object.assign(new Error("late failure"), { status: 503 });
    const model = new StreamQueueModel([
      [
        { type: "text_delta", delta: "partial" },
        { type: "error", error },
      ],
      [{ type: "final", response: response("unexpected") }],
    ]);

    const events = await collect(
      createCompletionStream("hello", {
        model,
        retries: { initialDelayMs: 0, maxDelayMs: 0 },
      }),
    );

    expect(events.map((event) => event.type)).toEqual(["text_delta", "error"]);
    expect(model.requests).toHaveLength(1);
  });

  it("retries a thrown stream failure before exposing events", async () => {
    const error = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const model = new ThrowingStreamQueueModel(error);

    const events = await collect(
      createCompletionStream("hello", {
        model,
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    );

    expect(events.at(-1)).toMatchObject({ type: "final" });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]).toBe(model.requests[0]);
  });
});

class CompletionQueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test-model";
  readonly capabilities = { ...capabilities, streaming: false };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly queue: Array<Error | CompletionResponse>) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("No queued completion response.");
    return next;
  }
}

class StreamQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test-model";
  readonly capabilities = capabilities;
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly queue: CompletionStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    return response("unused");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    for (const event of this.queue.shift() ?? []) yield event;
  }
}

class ThrowingStreamQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test-model";
  readonly capabilities = capabilities;
  readonly requests: CompletionRequest[] = [];
  private attempt = 0;

  constructor(private readonly error: Error) {}

  async completion(): Promise<CompletionResponse> {
    return response("unused");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    this.attempt += 1;
    if (this.attempt === 1) throw this.error;
    yield { type: "final", response: response("ready") };
  }
}

function response(text: string, usageValue = Usage.empty()): CompletionResponse {
  return { choice: [AssistantContent.text(text)], usage: usageValue, rawResponse: {} };
}

function usage(inputTokens: number, outputTokens: number): ReturnType<typeof Usage.empty> {
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const event of events) values.push(event);
  return values;
}
