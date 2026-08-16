import { describe, expect, it } from "vitest";
import {
  Agent,
  type AgentStreamEvent,
  AssistantContent,
  assertCompleted,
  type CompletionModel,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  createHook,
  createObserver,
  defineGuardrailPolicy,
  defineInputGuardrail,
  defineOutputGuardrail,
  getAssistantGenerationMetadata,
  guardrails,
  type InputGuardrail,
  Message,
  type OutputGuardrail,
  type StreamingCompletionModel,
  Usage,
  withInternalAgentRunOptions,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  }
}

class StreamingQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionModelStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    yield* response;
  }
}

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

describe("guardrails", () => {
  it("preserves concrete text-pattern helper types by boundary", () => {
    const inputGuardrail: InputGuardrail = guardrails.blockText({
      id: "block-input-text",
      boundary: "input",
      patterns: ["blocked"],
      reason: "blocked_input",
    });
    const outputGuardrail: OutputGuardrail = guardrails.redactText({
      id: "redact-output-text",
      boundary: "output",
      patterns: ["secret"],
      reason: "secret_output",
    });

    expect(inputGuardrail.id).toBe("block-input-text");
    expect(outputGuardrail.id).toBe("redact-output-text");
  });

  it("rewrites input before model execution", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const inputGuardrail = defineInputGuardrail({
      id: "redact-input",
      check(ctx, { rewrite }) {
        return rewrite({
          inputText: ctx.inputText.replace("secret", "[redacted]"),
          reason: "input_redacted",
        });
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      guardrails: defineGuardrailPolicy({ id: "policy", input: [inputGuardrail] }),
    });

    const result = await agent.generate({ prompt: "hello secret" });
    assertCompleted(result);

    expect(result.output).toBe("done");
    expect(model.requests[0]?.chatHistory).toEqual([
      Message.user([{ type: "text", text: "hello [redacted]" }]),
    ]);
    expect(result.guardrails).toMatchObject([
      { guardrailId: "redact-input", action: "rewrite", applied: true },
    ]);
  });

  it("blocks input without calling the model", async () => {
    const model = new QueueModel([]);
    const inputGuardrail = defineInputGuardrail({
      id: "block-input",
      check(_ctx, { block }) {
        return block({
          reason: "blocked",
          message: "Input blocked.",
        });
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      guardrails: defineGuardrailPolicy({ id: "policy", input: [inputGuardrail] }),
    });

    const result = await agent.generate({ prompt: "blocked" });

    expect(result).toMatchObject({ status: "blocked", stage: "input", text: "Input blocked." });
    if (result.status !== "blocked") throw new Error("Expected a blocked result.");
    expect(model.requests).toHaveLength(0);
    expect(result.guardrails).toMatchObject([
      { guardrailId: "block-input", action: "block", applied: true },
    ]);
  });

  it("records blocked input guardrail decisions through observers", async () => {
    const model = new QueueModel([]);
    const observedEvents: unknown[] = [];
    const trace = { traceId: "trace-blocked", observationId: "run-blocked" };
    const observer = createObserver({
      startRun() {
        return {
          trace,
          event(args) {
            observedEvents.push(args);
          },
          end() {},
        };
      },
    });
    const inputGuardrail = defineInputGuardrail({
      id: "block-observed-input",
      check(_ctx, { block }) {
        return block({ reason: "blocked", message: "Input blocked." });
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
      guardrails: defineGuardrailPolicy({ id: "policy", input: [inputGuardrail] }),
    });

    const result = await agent.generate({ prompt: "blocked" });

    expect(result).toMatchObject({ status: "blocked", stage: "input", text: "Input blocked." });
    if (result.status !== "blocked") throw new Error("Expected a blocked result.");
    expect(result.trace).toEqual({ observer: "test", ...trace });
    expect(observedEvents).toMatchObject([
      {
        name: "guardrail.decision",
        level: "WARNING",
        attributes: {
          policyId: "policy",
          guardrailId: "block-observed-input",
          boundary: "input",
          action: "block",
          applied: true,
        },
      },
    ]);
  });

  it("includes observer trace in a blocked streaming final event", async () => {
    const model = new StreamingQueueModel([]);
    const trace = { traceId: "trace-stream-blocked", observationId: "run-stream-blocked" };
    const inputGuardrail = defineInputGuardrail({
      id: "block-stream-input",
      check(_ctx, { block }) {
        return block({ reason: "blocked", message: "Stream input blocked." });
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: {
        observers: {
          test: createObserver({
            startRun() {
              return { trace, end() {} };
            },
          }),
        },
        primaryTrace: "test",
      },
      guardrails: defineGuardrailPolicy({ id: "policy", input: [inputGuardrail] }),
    });

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.stream({ prompt: "blocked" })) {
      events.push(event);
    }

    expect(model.requests).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: {
        status: "blocked",
        stage: "input",
        text: "Stream input blocked.",
        trace,
      },
    });
  });

  it("redacts repeated regex matches and text document sources", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("first")]),
      response([AssistantContent.text("second")]),
    ]);
    const redactInput = guardrails.redactText({
      id: "redact-repeated-input",
      boundary: "input",
      patterns: [/secret/g],
      reason: "secret_redacted",
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      guardrails: defineGuardrailPolicy({ id: "policy", input: [redactInput] }),
    });

    await agent.generate({
      messages: [
        Message.user([
          { type: "text", text: "secret secret" },
          {
            type: "file",
            data: { type: "text", text: "secret doc" },
            mediaType: "text/plain",
          },
        ]),
      ],
    });
    await agent.generate({ prompt: "secret" });

    expect(model.requests[0]?.chatHistory[0]).toEqual(
      Message.user([{ type: "text", text: "[redacted] [redacted]\n[redacted] doc" }]),
    );
    expect(model.requests[1]?.chatHistory[0]).toEqual(
      Message.user([{ type: "text", text: "[redacted]" }]),
    );
  });

  it("rewrites final output before returning and committing the assistant message", async () => {
    const model = new QueueModel([response([AssistantContent.text("secret token")])]);
    const outputGuardrail = defineOutputGuardrail({
      id: "safe-output",
      check(ctx, { rewrite }) {
        return rewrite({
          outputText: ctx.outputText.replace("secret", "[redacted]"),
          reason: "output_redacted",
        });
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      guardrails: defineGuardrailPolicy({ id: "policy", output: [outputGuardrail] }),
    });

    const result = await agent.generate({ prompt: "hello" });
    assertCompleted(result);

    expect(result.output).toBe("[redacted] token");
    const assistantMessage = result.messages.at(-1);
    expect(assistantMessage).toMatchObject(Message.assistant("[redacted] token"));
    expect(assistantMessage && getAssistantGenerationMetadata(assistantMessage)).toEqual({
      provider: "test",
      modelId: "test",
      usage: Usage.empty(),
    });
    expect(result.guardrails).toMatchObject([
      { guardrailId: "safe-output", action: "rewrite", applied: true },
    ]);
  });

  it("buffers streamed text when enforced output guardrails are active", async () => {
    const model = new StreamingQueueModel([
      [
        { type: "text_delta", delta: "secret token" },
        { type: "final", response: response([AssistantContent.text("secret token")]) },
      ],
    ]);
    const outputGuardrail = defineOutputGuardrail({
      id: "stream-output",
      check(ctx, { rewrite }) {
        return rewrite({
          outputText: ctx.outputText.replace("secret", "[redacted]"),
          reason: "output_redacted",
        });
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      guardrails: defineGuardrailPolicy({ id: "policy", output: [outputGuardrail] }),
    });

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.stream({ prompt: "hello" })) {
      events.push(event);
    }

    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text_delta", delta: "secret token" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text_delta", delta: "[redacted] token" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "guardrail_decision",
        decision: expect.objectContaining({ guardrailId: "stream-output", action: "rewrite" }),
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: { output: "[redacted] token" },
    });
  });

  it("skips output guardrails for streamed intermediate turns when steering continues", async () => {
    const checkedOutputs: string[] = [];
    const model = new StreamingQueueModel([
      [
        { type: "text_delta", delta: "secret first" },
        { type: "final", response: response([AssistantContent.text("secret first")]) },
      ],
      [
        { type: "text_delta", delta: "secret second" },
        { type: "final", response: response([AssistantContent.text("secret second")]) },
      ],
    ]);
    let steer: ((input: { prompt: string }) => boolean) | undefined;
    const outputGuardrail = defineOutputGuardrail({
      id: "stream-final-only",
      check(ctx, { rewrite }) {
        checkedOutputs.push(ctx.outputText);
        return rewrite({
          outputText: ctx.outputText.replace("secret", "[redacted]"),
          reason: "output_redacted",
        });
      },
    });
    const hook = createHook({
      onTurnEnd({ turn }) {
        if (turn === 1) {
          expect(steer?.({ prompt: "revise" })).toBe(true);
        }
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      guardrails: defineGuardrailPolicy({ id: "policy", output: [outputGuardrail] }),
    });
    const stream = agent.stream({ prompt: "hello", ...withInternalAgentRunOptions({}, { hook }) });
    steer = stream.steer.bind(stream);

    const events: AgentStreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(checkedOutputs).toEqual(["secret second"]);
    expect(model.requests).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: { output: "[redacted] second" },
    });
  });
});
