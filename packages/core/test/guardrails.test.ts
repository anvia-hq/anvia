import { describe, expect, it } from "vitest";
import {
  AgentBuilder,
  type AgentStreamEvent,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
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
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
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
  readonly defaultModel = "test";
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

  constructor(private readonly responses: CompletionStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
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
    const agent = new AgentBuilder("test-agent", model)
      .guardrails(defineGuardrailPolicy({ id: "policy", input: [inputGuardrail] }))
      .build();

    const result = await agent.prompt("hello secret").send();

    expect(result.output).toBe("done");
    expect(model.requests[0]?.chatHistory).toEqual([Message.user("hello [redacted]")]);
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
    const agent = new AgentBuilder("test-agent", model)
      .guardrails(defineGuardrailPolicy({ id: "policy", input: [inputGuardrail] }))
      .build();

    const result = await agent.prompt("blocked").send();

    expect(result.output).toBe("Input blocked.");
    expect(model.requests).toHaveLength(0);
    expect(result.guardrails).toMatchObject([
      { guardrailId: "block-input", action: "block", applied: true },
    ]);
  });

  it("records blocked input guardrail decisions through observers", async () => {
    const model = new QueueModel([]);
    const observedEvents: unknown[] = [];
    const observer = createObserver({
      startRun() {
        return {
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
    const agent = new AgentBuilder("test-agent", model)
      .observe(observer)
      .guardrails(defineGuardrailPolicy({ id: "policy", input: [inputGuardrail] }))
      .build();

    const result = await agent.prompt("blocked").send();

    expect(result.output).toBe("Input blocked.");
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
    const agent = new AgentBuilder("test-agent", model)
      .guardrails(defineGuardrailPolicy({ id: "policy", input: [redactInput] }))
      .build();

    await agent
      .prompt(
        Message.user([
          { type: "text", text: "secret secret" },
          { type: "document", source: { type: "text", text: "secret doc" } },
        ]),
      )
      .send();
    await agent.prompt("secret").send();

    expect(model.requests[0]?.chatHistory[0]).toEqual(
      Message.user("[redacted] [redacted]\n[redacted] doc"),
    );
    expect(model.requests[1]?.chatHistory[0]).toEqual(Message.user("[redacted]"));
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
    const agent = new AgentBuilder("test-agent", model)
      .guardrails(defineGuardrailPolicy({ id: "policy", output: [outputGuardrail] }))
      .build();

    const result = await agent.prompt("hello").send();

    expect(result.output).toBe("[redacted] token");
    const assistantMessage = result.messages.at(-1);
    expect(assistantMessage).toMatchObject(Message.assistant("[redacted] token"));
    expect(assistantMessage && getAssistantGenerationMetadata(assistantMessage)).toEqual({
      provider: "test",
      model: "test",
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
    const agent = new AgentBuilder("test-agent", model)
      .guardrails(defineGuardrailPolicy({ id: "policy", output: [outputGuardrail] }))
      .build();

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.prompt("hello").stream()) {
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
    expect(events.at(-1)).toMatchObject({ type: "final", output: "[redacted] token" });
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
    let steer: ((input: string) => boolean) | undefined;
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
    const agent = new AgentBuilder("test-agent", model)
      .hook(
        createHook({
          onTurnEnd({ turn }) {
            if (turn === 1) {
              expect(steer?.("revise")).toBe(true);
            }
          },
        }),
      )
      .guardrails(defineGuardrailPolicy({ id: "policy", output: [outputGuardrail] }))
      .build();
    const request = agent.prompt("hello");
    steer = request.steer.bind(request);

    const events: AgentStreamEvent[] = [];
    for await (const event of request.stream()) {
      events.push(event);
    }

    expect(checkedOutputs).toEqual(["secret second"]);
    expect(model.requests).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "final", output: "[redacted] second" });
  });
});
