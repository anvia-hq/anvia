import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AssistantContent,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  CompletionStructuredOutputError,
  generateCompletion,
  type StreamingCompletionModel,
  streamCompletion,
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

    const result = await generateCompletion({
      model,
      prompt: "hello",
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

  it("ignores invalid HTTP status values when classifying retryable error codes", async () => {
    const error = Object.assign(new Error("socket reset"), {
      status: 0,
      code: "ECONNRESET",
    });
    const model = new CompletionQueueModel([error, response("recovered")]);

    const result = await generateCompletion({
      model,
      prompt: "hello",
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    expect(result.text).toBe("recovered");
    expect(model.requests).toHaveLength(2);
  });

  it("uses completion retries before parsing structured output", async () => {
    const error = Object.assign(new Error("unavailable"), { status: 503 });
    const model = new CompletionQueueModel([error, response('{"ok":true}')]);

    const result = await generateCompletion({
      model,
      prompt: "hello",
      outputSchema: z.object({ ok: z.boolean() }),
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    expect(result.output).toEqual({ ok: true });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]).toBe(model.requests[0]);
  });

  it("does not retry parsed-output validation failures", async () => {
    const model = new CompletionQueueModel([response("not json"), response('{"ok":true}')]);

    await expect(
      generateCompletion({
        model,
        prompt: "hello",
        outputSchema: z.object({ ok: z.boolean() }),
        retries: { initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toMatchObject({
      name: "CompletionStructuredOutputError",
      phase: "parse",
    });
    expect(model.requests).toHaveLength(1);
  });

  it("reports truncated structured output distinctly and preserves ordinary partial text", async () => {
    const partial = response('{"ok":');
    partial.finishReason = "length";
    partial.providerFinishReason = "length";
    const structuredModel = new CompletionQueueModel([partial]);

    const error = await generateCompletion({
      model: structuredModel,
      prompt: "hello",
      outputSchema: z.object({ ok: z.boolean() }),
    }).catch((value) => value);

    expect(error).toBeInstanceOf(CompletionStructuredOutputError);
    expect(error).toMatchObject({
      phase: "truncated",
      outputLength: 6,
      finishReason: "length",
      providerFinishReason: "length",
    });

    const ordinaryModel = new CompletionQueueModel([partial]);
    await expect(
      generateCompletion({ model: ordinaryModel, prompt: "hello" }),
    ).resolves.toMatchObject({
      text: '{"ok":',
      output: '{"ok":',
      finishReason: "length",
      providerFinishReason: "length",
    });
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
      streamCompletion({
        model,
        prompt: "hello",
        retries: { initialDelayMs: 0, maxDelayMs: 0 },
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "final",
      result: { usage: Usage.add(failedUsage, finalUsage) },
    });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]).toBe(model.requests[0]);
  });

  it("emits a dedicated error for a length-terminated structured stream", async () => {
    const partial = response('{"ok":');
    partial.finishReason = "length";
    partial.providerFinishReason = "length";
    const model = new StreamQueueModel([[{ type: "final", response: partial }]]);

    const events = await collect(
      streamCompletion({
        model,
        prompt: "hello",
        outputSchema: z.object({ ok: z.boolean() }),
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      error: {
        name: "CompletionStructuredOutputError",
        phase: "truncated",
        finishReason: "length",
      },
    });
  });

  it("closes a failed stream attempt before waiting to retry", async () => {
    const error = Object.assign(new Error("unavailable"), { status: 503 });
    const model = new ClosingStreamModel(error);
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      expect(model.closed).toBe(true);
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    try {
      const events = await collect(
        streamCompletion({
          model,
          prompt: "hello",
          retries: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
        }),
      );

      expect(events.at(-1)).toMatchObject({ type: "final" });
      expect(timer).toHaveBeenCalledOnce();
    } finally {
      timer.mockRestore();
      random.mockRestore();
    }
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
      streamCompletion({
        model,
        prompt: "hello",
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
      streamCompletion({
        model,
        prompt: "hello",
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
  readonly modelId = "test-model";
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
  readonly modelId = "test-model";
  readonly capabilities = capabilities;
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly queue: CompletionModelStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    return response("unused");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    for (const event of this.queue.shift() ?? []) yield event;
  }
}

class ThrowingStreamQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "test-model";
  readonly capabilities = capabilities;
  readonly requests: CompletionRequest[] = [];
  private attempt = 0;

  constructor(private readonly error: Error) {}

  async completion(): Promise<CompletionResponse> {
    return response("unused");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    this.attempt += 1;
    if (this.attempt === 1) throw this.error;
    yield { type: "final", response: response("ready") };
  }
}

class ClosingStreamModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "test-model";
  readonly capabilities = capabilities;
  readonly requests: CompletionRequest[] = [];
  closed = false;
  private attempt = 0;

  constructor(private readonly error: Error) {}

  async completion(): Promise<CompletionResponse> {
    return response("unused");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    this.attempt += 1;
    if (this.attempt === 1) {
      try {
        yield { type: "error", error: this.error };
      } finally {
        this.closed = true;
      }
      return;
    }
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
