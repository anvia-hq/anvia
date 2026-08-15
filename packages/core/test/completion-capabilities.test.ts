import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AssistantContent,
  assertCompletionRequestSupported,
  CompletionCapabilityError,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  generateCompletion,
  Message,
  type StreamingCompletionModel,
  streamCompletion,
  Usage,
  UserContent,
} from "./helpers/imports";

const fullCapabilities: CompletionModelCapabilities = {
  streaming: true,
  tools: true,
  toolChoice: true,
  imageInput: true,
  documentInput: true,
  outputSchema: true,
  reasoning: true,
};

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test-model";
  readonly capabilities: CompletionModelCapabilities;
  readonly requests: CompletionRequest[] = [];

  constructor(
    capabilities: Partial<CompletionModelCapabilities> = {},
    private readonly choice = [AssistantContent.text("ok")],
  ) {
    this.capabilities = { ...fullCapabilities, streaming: false, ...capabilities };
  }

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    return {
      choice: this.choice,
      usage: Usage.empty(),
      rawResponse: {},
    };
  }
}

class StreamingQueueModel extends QueueModel implements StreamingCompletionModel {
  constructor(
    capabilities: Partial<CompletionModelCapabilities> = {},
    private readonly streamChoice = [AssistantContent.text("ok")],
  ) {
    super({ streaming: true, ...capabilities });
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    yield {
      type: "final",
      response: {
        choice: this.streamChoice,
        usage: Usage.empty(),
        rawResponse: {},
      },
    };
  }
}

describe("completion model capabilities", () => {
  it("accepts supported text, tools, schema, and attachments", () => {
    const model = new QueueModel(fullCapabilities);
    const request: CompletionRequest = {
      chatHistory: [
        Message.user([
          UserContent.text("Inspect this."),
          UserContent.imageUrl("https://example.com/a.png"),
          UserContent.documentUrl("https://example.com/a.pdf", "application/pdf"),
        ]),
      ],
      documents: [{ id: "context", text: "Static context is text." }],
      tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" } }],
      toolChoice: "auto",
      outputSchema: { type: "object" },
    };

    expect(() => assertCompletionRequestSupported(model, request)).not.toThrow();
  });

  it("rejects unsupported request features with clear errors", () => {
    const baseRequest: CompletionRequest = {
      chatHistory: [Message.user("hello")],
      documents: [],
      tools: [],
    };

    expect(() =>
      assertCompletionRequestSupported(new QueueModel({ tools: false }), {
        ...baseRequest,
        tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" } }],
      }),
    ).toThrow(CompletionCapabilityError);

    expect(() =>
      assertCompletionRequestSupported(new QueueModel({ toolChoice: false }), {
        ...baseRequest,
        toolChoice: "required",
      }),
    ).toThrow("test:test-model does not support tool choice.");

    expect(() =>
      assertCompletionRequestSupported(new QueueModel({ imageInput: false }), {
        ...baseRequest,
        chatHistory: [Message.user([UserContent.imageUrl("https://example.com/a.png")])],
      }),
    ).toThrow("test:test-model does not support image input.");

    expect(() =>
      assertCompletionRequestSupported(new QueueModel({ documentInput: false }), {
        ...baseRequest,
        chatHistory: [
          Message.user([UserContent.documentUrl("https://example.com/a.pdf", "application/pdf")]),
        ],
      }),
    ).toThrow("test:test-model does not support document file input.");

    expect(() =>
      assertCompletionRequestSupported(new QueueModel({ outputSchema: false }), {
        ...baseRequest,
        outputSchema: { type: "object" },
      }),
    ).toThrow("test:test-model does not support output schemas.");
  });

  it("does not treat static context or text content as file document input", () => {
    const model = new QueueModel({ documentInput: false });

    expect(() =>
      assertCompletionRequestSupported(model, {
        chatHistory: [Message.user([UserContent.text("hello"), UserContent.documentText("text")])],
        documents: [{ id: "policy", text: "Policy text." }],
        tools: [],
      }),
    ).not.toThrow();
  });

  it("Agent.generate enforces capabilities before model calls", async () => {
    const model = new QueueModel({ imageInput: false });
    const agent = new Agent({ id: "agent", model });

    await expect(
      agent.generate(Message.user([UserContent.imageUrl("https://example.com/a.png")])),
    ).rejects.toThrow("test:test-model does not support image input.");
    expect(model.requests).toHaveLength(0);
  });

  it("Agent.stream enforces streaming capabilities before model calls", async () => {
    const model = new StreamingQueueModel({ streaming: false });
    const agent = new Agent({ id: "agent", model });

    expect(() => agent.stream("hello")).toThrow("This completion model does not support streaming");
    expect(model.requests).toHaveLength(0);
  });
});

describe("generateCompletion", () => {
  it("creates a non-streaming completion with ergonomic result fields", async () => {
    const model = new QueueModel();
    const response = await generateCompletion({
      model,
      prompt: "hello",
      instructions: "system",
      documents: [{ id: "policy", text: "Policy text." }],
      tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" } }],
      temperature: 0.2,
      maxTokens: 128,
      toolChoice: "auto",
      providerOptions: { reasoning: { effort: "low" } },
    });

    expect(response).toMatchObject({
      text: "ok",
      content: [AssistantContent.text("ok")],
      usage: Usage.empty(),
    });
    expect(response.output).toBe("ok");
    expect(response.rawResponse).toEqual({});
    expect(model.requests).toEqual([
      {
        chatHistory: [Message.user("hello")],
        instructions: "system",
        documents: [{ id: "policy", text: "Policy text." }],
        tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" } }],
        temperature: 0.2,
        maxTokens: 128,
        toolChoice: "auto",
        providerOptions: { reasoning: { effort: "low" } },
      },
    ]);
  });

  it("appends input after transcript messages", async () => {
    const model = new QueueModel();
    await generateCompletion({
      model,
      messages: [
        Message.user("My project is named Anvia."),
        Message.assistant("Noted."),
        Message.user("What is my project named?"),
      ],
    });

    expect(model.requests[0]?.chatHistory).toEqual([
      Message.user("My project is named Anvia."),
      Message.assistant("Noted."),
      Message.user("What is my project named?"),
    ]);
  });

  it("requires exactly one of prompt or messages at runtime", async () => {
    const model = new QueueModel();

    await expect(
      generateCompletion({
        model,
        prompt: "hello",
        messages: [Message.user("hello")],
      } as never),
    ).rejects.toThrow("Exactly one of prompt or messages must be provided.");
    await expect(generateCompletion({ model } as never)).rejects.toThrow(
      "Exactly one of prompt or messages must be provided.",
    );
    expect(model.requests).toHaveLength(0);
  });

  it("requires a non-empty input transcript", async () => {
    const model = new QueueModel();

    await expect(generateCompletion({ model, messages: [] })).rejects.toThrow(
      "input must contain at least one Message.",
    );
    expect(model.requests).toHaveLength(0);
  });

  it("streams normalized completion events with streamCompletion", async () => {
    const model = new StreamingQueueModel();

    const events = await collect(
      streamCompletion({
        model,
        prompt: "hello",
      }),
    );

    expect(events).toEqual([
      {
        type: "final",
        result: {
          output: "ok",
          text: "ok",
          content: [AssistantContent.text("ok")],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
    ]);
    expect(model.requests).toEqual([
      {
        chatHistory: [Message.user("hello")],
        documents: [],
        tools: [],
      },
    ]);
  });

  it("parses and types schema-backed stream final results", async () => {
    const model = new StreamingQueueModel({}, [AssistantContent.text('{"title":"Typed"}')]);
    const events = await collect(
      streamCompletion({
        model,
        prompt: "extract",
        outputSchema: z.object({ title: z.string() }),
      }),
    );
    const final = events.at(-1);

    expect(final?.type).toBe("final");
    if (final?.type !== "final") throw new Error("Expected a final event.");
    expectTypeOf(final.result.output).toEqualTypeOf<{ title: string }>();
    expect(final.result).toMatchObject({
      output: { title: "Typed" },
      text: '{"title":"Typed"}',
    });
  });

  it("emits one error event and closes when streamed structured output is invalid", async () => {
    const model = new StreamingQueueModel({}, [AssistantContent.text("not json")]);
    const events = await collect(
      streamCompletion({
        model,
        prompt: "extract",
        outputSchema: z.object({ title: z.string() }),
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      error: { message: "generateCompletion expected the model response to be valid JSON." },
    });
  });

  it("rejects unsupported streaming before model calls", async () => {
    const model = new StreamingQueueModel({ streaming: false });

    expect(() =>
      streamCompletion({
        model,
        prompt: "hello",
      }),
    ).toThrow("This completion model does not support streaming");
    expect(model.requests).toHaveLength(0);
  });

  it("enforces capabilities before model calls", async () => {
    const model = new QueueModel({ tools: false });

    await expect(
      generateCompletion({
        model,
        prompt: "hello",
        tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" } }],
      }),
    ).rejects.toThrow("test:test-model does not support tool definitions.");
    expect(model.requests).toHaveLength(0);
  });

  it("creates a parsed completion with schema validation", async () => {
    const schema = z.object({
      title: z.string(),
      priority: z.enum(["low", "medium", "high"]),
    });
    const model = new QueueModel({}, [
      AssistantContent.text(JSON.stringify({ title: "Checkout failure", priority: "high" })),
    ]);

    const response = await generateCompletion({
      model,
      messages: [
        Message.system("Extract ticket fields."),
        Message.user("Acme has an urgent checkout failure."),
      ],
      outputSchema: schema,
      instructions: "Return only structured ticket data.",
      providerOptions: { reasoning: { effort: "low" } },
    });

    expect(response.output).toEqual({ title: "Checkout failure", priority: "high" });
    expect(response.text).toBe('{"title":"Checkout failure","priority":"high"}');
    expect(model.requests).toEqual([
      {
        chatHistory: [
          Message.system("Extract ticket fields."),
          Message.user("Acme has an urgent checkout failure."),
        ],
        instructions: "Return only structured ticket data.",
        documents: [],
        tools: [],
        outputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["title", "priority"],
          additionalProperties: false,
        },
        providerOptions: { reasoning: { effort: "low" } },
      },
    ]);
  });

  it("rejects parsed completion when output schemas are unsupported", async () => {
    const model = new QueueModel({ outputSchema: false });

    await expect(
      generateCompletion({
        model,
        prompt: "hello",
        outputSchema: z.object({ title: z.string() }),
      }),
    ).rejects.toThrow("test:test-model does not support output schemas.");
    expect(model.requests).toHaveLength(0);
  });

  it("rejects parsed completion when model text is invalid JSON", async () => {
    const model = new QueueModel({}, [AssistantContent.text("not json")]);

    await expect(
      generateCompletion({
        model,
        prompt: "hello",
        outputSchema: z.object({ title: z.string() }),
      }),
    ).rejects.toThrow("generateCompletion expected the model response to be valid JSON.");
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
