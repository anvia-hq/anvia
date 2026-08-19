import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AssistantContent,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
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

  it("preserves failed-attempt usage even when totalTokens is zero", async () => {
    const failedUsage = { ...Usage.empty(), inputTokens: 2, details: { billed: 2 } };
    const error = new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      usage: failedUsage,
    });
    const model = new CompletionQueueModel([error, response("recovered", usage(0, 1))]);

    const result = await generateCompletion({
      model,
      prompt: "hello",
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    expect(result.usage).toMatchObject({ inputTokens: 2, outputTokens: 1, totalTokens: 1 });
    expect(model.requests).toHaveLength(2);
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

  it("rejects syntactically valid values outside the JSON contract", async () => {
    const model = new CompletionQueueModel([response('{"value":1e400}')]);

    await expect(
      generateCompletion({
        model,
        prompt: "hello",
        outputSchema: z.object({ value: z.any() }),
      }),
    ).rejects.toMatchObject({
      name: "CompletionStructuredOutputError",
      phase: "parse",
    });
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

  it("rejects content-filtered structured output without retrying or parsing it", async () => {
    const filtered = response('{"ok":true}');
    filtered.finishReason = "content-filter";
    filtered.providerFinishReason = "content_filter";
    const model = new CompletionQueueModel([filtered, response('{"ok":true}')]);

    await expect(
      generateCompletion({
        model,
        prompt: "hello",
        outputSchema: z.object({ ok: z.boolean() }),
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toMatchObject({
      name: "CompletionStructuredOutputError",
      phase: "content-filter",
      finishReason: "content-filter",
      providerFinishReason: "content_filter",
    });
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

  it("preserves zero-total failed usage across a stream retry", async () => {
    const failedUsage = { ...Usage.empty(), cachedInputTokens: 3 };
    const error = new CompletionProviderOutputError({
      kind: "incomplete-stream",
      usage: failedUsage,
    });
    const finalUsage = usage(0, 1);
    const model = new StreamQueueModel([
      [{ type: "error", error }],
      [{ type: "final", response: response("ready", finalUsage) }],
    ]);

    const events = await collect(
      streamCompletion({
        model,
        prompt: "hello",
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: {
        usage: expect.objectContaining({ cachedInputTokens: 3, outputTokens: 1, totalTokens: 1 }),
      },
    });
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

  it("merges streamed tool-call deltas into an empty terminal snapshot", async () => {
    const terminal: CompletionResponse = {
      choice: [],
      usage: usage(3, 2),
      rawResponse: { id: "response_1" },
      finishReason: "tool-calls",
    };
    const model = new StreamQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "tool_0",
          callId: "call_0",
          name: "lookup",
          argumentsDelta: '{"query":"anvia"}',
        },
        { type: "final", response: terminal },
      ],
    ]);

    const events = await collect(streamCompletion({ model, prompt: "look up Anvia" }));

    expect(events).toEqual([
      {
        type: "tool_call_delta",
        id: "tool_0",
        callId: "call_0",
        name: "lookup",
        argumentsDelta: '{"query":"anvia"}',
      },
      {
        type: "final",
        result: {
          output: "",
          text: "",
          content: [AssistantContent.toolCall("tool_0", "lookup", { query: "anvia" }, "call_0")],
          usage: usage(3, 2),
          rawResponse: { id: "response_1" },
          finishReason: "tool-calls",
        },
      },
    ]);
  });

  it("classifies a tool-call stream without a terminal response", async () => {
    const model = new StreamQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "tool_0",
          name: "lookup",
          argumentsDelta: '{"query":"anvia"}',
        },
      ],
    ]);

    const events = await collect(streamCompletion({ model, prompt: "look up Anvia" }));

    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: { kind: "incomplete-tool-call", toolCallId: "tool_0" },
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
