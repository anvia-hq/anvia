import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentRunCancelledError,
  AgentStructuredOutputError,
  AssistantContent,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  createTool,
  type ModelCallOptions,
  type StreamingCompletionModel,
} from "./helpers/imports";

const structuredSchema = z.object({
  phase: z.literal("hypotheses"),
  hypotheses: z.array(z.string()),
});

const rawJson = '{"phase":"hypotheses","hypotheses":[]}';
const fencedJson = `\`\`\`json
{
  "phase": "hypotheses",
  "hypotheses": []
}
\`\`\``;

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "structured-output";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly outputs: Array<string | Error | CompletionResponse>) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const output = this.outputs.shift();
    if (output === undefined) throw new Error("No queued model output.");
    if (output instanceof Error) throw output;
    return typeof output === "string" ? response(output) : output;
  }
}

class StreamingQueueModel extends QueueModel implements StreamingCompletionModel {
  constructor(
    private readonly streamingOutputs: Array<string | readonly CompletionModelStreamEvent[]>,
  ) {
    super([]);
  }

  override readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    const output = this.streamingOutputs.shift();
    if (output === undefined) throw new Error("No queued streaming model output.");
    if (typeof output === "string") {
      yield { type: "final", response: response(output) };
      return;
    }
    yield* output;
  }
}

describe("Agent structured output", () => {
  it.each([
    ["raw JSON", rawJson],
    ["a lowercase json fence", fencedJson],
    ["an unlabeled fence", `\`\`\`\n${rawJson}\n\`\`\``],
    ["surrounding whitespace around a complete fence", ` \n${fencedJson}\n\t`],
  ])("accepts %s and preserves schema validation", async (_name, output) => {
    const agent = new Agent({
      id: "structured",
      model: new QueueModel([output]),
      outputSchema: structuredSchema,
    });

    await expect(agent.generate({ prompt: "Create hypotheses." })).resolves.toMatchObject({
      status: "completed",
      output: { phase: "hypotheses", hypotheses: [] },
      text: output,
    });
  });

  it("reports provider truncation before attempting to parse partial JSON", async () => {
    const partial = '{"phase":"hypotheses","hypotheses":["unfinished';
    const modelResponse = response(partial);
    modelResponse.finishReason = "length";
    modelResponse.providerFinishReason = "length";
    const agent = new Agent({
      id: "structured",
      model: new QueueModel([modelResponse]),
      outputSchema: structuredSchema,
    });

    const error = await agent.generate({ prompt: "Create hypotheses." }).catch((value) => value);

    expect(error).toBeInstanceOf(AgentStructuredOutputError);
    expect(error).toMatchObject({
      phase: "truncated",
      outputLength: partial.length,
      normalizedLength: partial.length,
      finishReason: "length",
      providerFinishReason: "length",
      attemptUsage: { totalTokens: 1 },
      usage: { totalTokens: 1 },
    });
    expect(error.cause).toBeUndefined();
  });

  it("retries truncation from the original request without replaying partial output", async () => {
    const partial = '{"phase":"hypotheses","hypotheses":["private partial';
    const truncated = response(partial);
    truncated.finishReason = "length";
    truncated.providerFinishReason = "length";
    const model = new QueueModel([truncated, rawJson]);
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(agent.generate({ prompt: "Create hypotheses." })).resolves.toMatchObject({
      output: { phase: "hypotheses", hypotheses: [] },
      usage: { totalTokens: 2 },
    });
    expect(JSON.stringify(model.requests[1])).not.toContain("private partial");
    expect(model.requests[1]?.chatHistory).toEqual([
      { role: "user", content: "Create hypotheses." },
      {
        role: "user",
        content:
          "Your previous response exceeded the provider output limit. Return substantially shorter raw JSON that matches the supplied JSON schema. Do not use Markdown fences or include commentary.",
      },
    ]);
  });

  it("bounds repair previews, excludes reasoning, and never accumulates failed attempts", async () => {
    const firstText = `first-private-${"a".repeat(12_000)}`;
    const secondText = `second-private-${"b".repeat(12_000)}`;
    const first = response(firstText);
    first.choice.unshift({ type: "reasoning", text: "first-secret-reasoning" });
    const second = response(secondText);
    second.choice.unshift({ type: "reasoning", text: "second-secret-reasoning" });
    const model = new QueueModel([first, second, rawJson]);
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
    });

    await agent.generate({ prompt: "Create hypotheses." });

    expect(model.requests).toHaveLength(3);
    for (const request of model.requests.slice(1)) {
      expect(request.chatHistory).toHaveLength(3);
      expect(JSON.stringify(request)).not.toContain("secret-reasoning");
      const repair = request.chatHistory[1];
      expect(repair?.role).toBe("assistant");
      if (repair?.role !== "assistant" || typeof repair.content === "string") {
        throw new Error("Expected a text-only repair preview.");
      }
      const text = repair.content.find((part) => part.type === "text")?.text;
      expect(text?.length).toBeLessThanOrEqual(8_192);
    }
    expect(JSON.stringify(model.requests[2])).toContain("second-private");
    expect(JSON.stringify(model.requests[2])).not.toContain("first-private");
  });

  it.each([
    ["prose before a fence", `Here is the result:\n${fencedJson}`],
    ["prose after a fence", `${fencedJson}\nHope this helps.`],
    ["malformed JSON inside a fence", '```json\n{"phase":\n```'],
  ])("rejects %s without extracting an embedded object", async (_name, output) => {
    const agent = new Agent({
      id: "structured",
      model: new QueueModel([output]),
      outputSchema: structuredSchema,
    });

    const error = await agent.generate({ prompt: "Create hypotheses." }).catch((value) => value);

    expect(error).toBeInstanceOf(AgentStructuredOutputError);
    expect(error).toMatchObject({
      name: "AgentStructuredOutputError",
      phase: "parse",
      attempt: 1,
      maxAttempts: 1,
      outputLength: output.length,
    });
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).not.toContain(output);
  });

  it("rejects valid JSON that fails the configured schema", async () => {
    const output = '{"phase":"final","hypotheses":[]}';
    const agent = new Agent({
      id: "structured",
      model: new QueueModel([output]),
      outputSchema: structuredSchema,
    });

    const error = await agent.generate({ prompt: "Create hypotheses." }).catch((value) => value);

    expect(error).toBeInstanceOf(AgentStructuredOutputError);
    expect(error).toMatchObject({ phase: "schema", attempt: 1, maxAttempts: 1 });
    expect(error.cause).toBeInstanceOf(z.ZodError);
    expect(error.message).not.toContain(output);
  });

  it.each([
    ["malformed JSON", "not json"],
    ["schema-invalid JSON", '{"phase":"final","hypotheses":[]}'],
  ])("retries %s and succeeds on a later valid response", async (_name, invalidOutput) => {
    const model = new QueueModel([invalidOutput, rawJson]);
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(agent.generate({ prompt: "Create hypotheses." })).resolves.toMatchObject({
      output: { phase: "hypotheses", hypotheses: [] },
      usage: { totalTokens: 2 },
    });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.chatHistory.slice(-2)).toEqual([
      { role: "assistant", content: [AssistantContent.text(invalidOutput)] },
      {
        role: "user",
        content:
          "Your previous response was invalid structured output. Return only raw JSON that matches the supplied JSON schema. Do not use Markdown fences or include commentary.",
      },
    ]);
  });

  it("stops at the exact total-attempt limit and preserves the final cause", async () => {
    const first = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new QueueModel([first, "still not json", rawJson]);
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    const error = await agent.generate({ prompt: "Create hypotheses." }).catch((value) => value);

    expect(model.requests).toHaveLength(2);
    expect(error).toBeInstanceOf(AgentStructuredOutputError);
    expect(error).toMatchObject({ phase: "parse", attempt: 2, maxAttempts: 2 });
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it("retains rejected-output usage when the retry ends in a provider failure", async () => {
    const providerError = new Error("provider rejected retry");
    const observedUsage: number[] = [];
    const model = new QueueModel(["not json", providerError]);
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      lifecycle: {
        onError({ usage }) {
          observedUsage.push(usage.totalTokens);
        },
      },
    });

    await expect(agent.generate({ prompt: "Create hypotheses." })).rejects.toBe(providerError);
    expect(model.requests).toHaveLength(2);
    expect(observedUsage).toEqual([1]);
  });

  it("retains rejected-output usage when the retry is aborted", async () => {
    const controller = new AbortController();
    const observedUsage: number[] = [];
    let calls = 0;
    let markRetryStarted: (() => void) | undefined;
    const retryStarted = new Promise<void>((resolve) => {
      markRetryStarted = resolve;
    });
    const model: CompletionModel = {
      provider: "test",
      modelId: "structured-abort",
      capabilities: new QueueModel([]).capabilities,
      async completion(
        _request: CompletionRequest,
        options?: ModelCallOptions,
      ): Promise<CompletionResponse> {
        calls += 1;
        if (calls === 1) return response("not json");
        const abortSignal = options?.abortSignal;
        if (abortSignal === undefined) throw new Error("Expected Agent abort signal.");
        markRetryStarted?.();
        return new Promise((_, reject) => {
          abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
        });
      },
    };
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      lifecycle: {
        onError({ usage }) {
          observedUsage.push(usage.totalTokens);
        },
      },
    });

    const result = agent.generate({ prompt: "Create hypotheses.", abortSignal: controller.signal });
    await retryStarted;
    controller.abort("stop retry");

    await expect(result).rejects.toBeInstanceOf(AgentRunCancelledError);
    expect(calls).toBe(2);
    expect(observedUsage).toEqual([1]);
  });

  it("does not retry structured failures unless retries are configured", async () => {
    const model = new QueueModel(["not json", rawJson]);
    const agent = new Agent({ id: "structured", model, outputSchema: structuredSchema });

    await expect(agent.generate({ prompt: "Create hypotheses." })).rejects.toBeInstanceOf(
      AgentStructuredOutputError,
    );
    expect(model.requests).toHaveLength(1);
  });

  it("buffers invalid structured streams and retries without exposing their text", async () => {
    const model = new StreamingQueueModel(["not json", rawJson]);
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });
    const events = [];

    for await (const event of agent.stream({ prompt: "Create hypotheses." })) {
      events.push(event);
    }

    expect(model.requests).toHaveLength(2);
    expect(events).not.toContainEqual(expect.objectContaining({ delta: "not json" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn_end",
        response: expect.objectContaining({ usage: expect.objectContaining({ totalTokens: 2 }) }),
      }),
    );
    const final = events.at(-1);
    expect(final).toMatchObject({
      type: "final",
      result: {
        output: { phase: "hypotheses", hypotheses: [] },
        usage: { totalTokens: 2 },
      },
    });
    if (final?.type !== "final") throw new Error("Expected final Agent event.");
    expect(final.result.messages.at(-1)?.metadata).toMatchObject({
      anvia: { generation: { usage: { totalTokens: 2 } } },
    });
  });

  it("retries a length-terminated structured stream without exposing or replaying it", async () => {
    const partial = response('{"phase":"hypotheses","hypotheses":["stream-private');
    partial.finishReason = "length";
    partial.providerFinishReason = "length";
    const model = new StreamingQueueModel([[{ type: "final", response: partial }], rawJson]);
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });
    const events = [];

    for await (const event of agent.stream({ prompt: "Create hypotheses." })) {
      events.push(event);
    }

    expect(JSON.stringify(events)).not.toContain("stream-private");
    expect(JSON.stringify(model.requests[1])).not.toContain("stream-private");
    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: { output: { phase: "hypotheses", hypotheses: [] } },
    });
  });

  it("replays buffered reasoning and text on structured tool-call turns", async () => {
    const toolCall = AssistantContent.toolCall("call_1", "lookup", {});
    const model = new StreamingQueueModel([
      [
        { type: "reasoning_delta", delta: "checking" },
        { type: "text_delta", delta: "working" },
        { type: "tool_call", toolCall },
      ],
      rawJson,
    ]);
    const lookup = createTool({
      name: "lookup",
      description: "Look up data.",
      inputSchema: z.object({}),
      execute: () => "found",
    });
    const agent = new Agent({
      id: "structured",
      model,
      outputSchema: structuredSchema,
      tools: [lookup],
    });
    const events = [];

    for await (const event of agent.stream({ prompt: "Create hypotheses." })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "generation_start",
      "reasoning_delta",
      "text_delta",
      "tool_call",
      "turn_end",
      "tool_result",
      "turn_start",
      "generation_start",
      "text_delta",
      "turn_end",
      "final",
    ]);
    expect(events).toContainEqual({ type: "reasoning_delta", turn: 1, delta: "checking" });
    expect(events).toContainEqual({ type: "text_delta", turn: 1, delta: "working" });
  });

  it("leaves ordinary non-structured Agent output unchanged", async () => {
    const partial = response(fencedJson);
    partial.finishReason = "length";
    partial.providerFinishReason = "length";
    const model = new QueueModel([partial]);
    const agent = new Agent({ id: "ordinary", model });

    await expect(agent.generate({ prompt: "Answer normally." })).resolves.toMatchObject({
      output: fencedJson,
      text: fencedJson,
      finishReason: "length",
      providerFinishReason: "length",
      messages: [
        expect.anything(),
        expect.objectContaining({
          metadata: {
            anvia: {
              generation: expect.objectContaining({
                finishReason: "length",
                providerFinishReason: "length",
              }),
            },
          },
        }),
      ],
    });
    expect(model.requests).toHaveLength(1);
  });
});

function response(text: string): CompletionResponse {
  return {
    choice: [AssistantContent.text(text)],
    usage: {
      inputTokens: 0,
      outputTokens: 1,
      totalTokens: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    rawResponse: {},
  };
}
