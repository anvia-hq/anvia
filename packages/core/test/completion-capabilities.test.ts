import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AssistantContent,
  assertCompletionRequestSupported,
  CompletionCapabilityError,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  createCompletion,
  createCompletionStream,
  createParsedCompletion,
  Message,
  type StreamingCompletionModel,
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
  constructor(capabilities: Partial<CompletionModelCapabilities> = {}) {
    super({ streaming: true, ...capabilities });
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    yield {
      type: "final",
      response: {
        choice: [AssistantContent.text("ok")],
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

    await expect(collect(agent.stream("hello"))).rejects.toThrow(
      "This completion model does not support streaming",
    );
    expect(model.requests).toHaveLength(0);
  });
});

describe("createCompletion", () => {
  it("creates a non-streaming completion with ergonomic result fields", async () => {
    const model = new QueueModel();
    const response = await createCompletion("hello", {
      model,
      instructions: "system",
      documents: [{ id: "policy", text: "Policy text." }],
      tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" } }],
      temperature: 0.2,
      maxTokens: 128,
      toolChoice: "auto",
      outputSchema: { type: "object" },
      additionalParams: { reasoning: { effort: "low" } },
    });

    expect(response).toMatchObject({
      text: "ok",
      content: [AssistantContent.text("ok")],
      usage: Usage.empty(),
    });
    expect(response.response).toBeDefined();
    expect(model.requests).toEqual([
      {
        chatHistory: [Message.user("hello")],
        instructions: "system",
        documents: [{ id: "policy", text: "Policy text." }],
        tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" } }],
        temperature: 0.2,
        maxTokens: 128,
        toolChoice: "auto",
        outputSchema: { type: "object" },
        additionalParams: { reasoning: { effort: "low" } },
      },
    ]);
  });

  it("appends input after transcript messages", async () => {
    const model = new QueueModel();
    await createCompletion(
      [
        Message.user("My project is named Anvia."),
        Message.assistant("Noted."),
        Message.user("What is my project named?"),
      ],
      { model },
    );

    expect(model.requests[0]?.chatHistory).toEqual([
      Message.user("My project is named Anvia."),
      Message.assistant("Noted."),
      Message.user("What is my project named?"),
    ]);
  });

  it("requires a non-empty input transcript", async () => {
    const model = new QueueModel();

    await expect(createCompletion([], { model })).rejects.toThrow(
      "input must contain at least one Message.",
    );
    expect(model.requests).toHaveLength(0);
  });

  it("streams completion events with createCompletionStream", async () => {
    const model = new StreamingQueueModel();

    const events = await collect(
      createCompletionStream("hello", {
        model,
      }),
    );

    expect(events).toEqual([
      {
        type: "final",
        response: {
          choice: [AssistantContent.text("ok")],
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

  it("rejects unsupported streaming before model calls", async () => {
    const model = new StreamingQueueModel({ streaming: false });

    expect(() =>
      createCompletionStream("hello", {
        model,
      }),
    ).toThrow("This completion model does not support streaming");
    expect(model.requests).toHaveLength(0);
  });

  it("enforces capabilities before model calls", async () => {
    const model = new QueueModel({ tools: false });

    await expect(
      createCompletion("hello", {
        model,
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

    const response = await createParsedCompletion(
      [
        Message.system("Extract ticket fields."),
        Message.user("Acme has an urgent checkout failure."),
      ],
      {
        model,
        schema,
        instructions: "Return only structured ticket data.",
        additionalParams: { reasoning: { effort: "low" } },
      },
    );

    expect(response.data).toEqual({ title: "Checkout failure", priority: "high" });
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
        additionalParams: { reasoning: { effort: "low" } },
      },
    ]);
  });

  it("rejects parsed completion when output schemas are unsupported", async () => {
    const model = new QueueModel({ outputSchema: false });

    await expect(
      createParsedCompletion("hello", {
        model,
        schema: z.object({ title: z.string() }),
      }),
    ).rejects.toThrow("test:test-model does not support output schemas.");
    expect(model.requests).toHaveLength(0);
  });

  it("rejects parsed completion when model text is invalid JSON", async () => {
    const model = new QueueModel({}, [AssistantContent.text("not json")]);

    await expect(
      createParsedCompletion("hello", {
        model,
        schema: z.object({ title: z.string() }),
      }),
    ).rejects.toThrow("createParsedCompletion expected the model response to be valid JSON.");
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
