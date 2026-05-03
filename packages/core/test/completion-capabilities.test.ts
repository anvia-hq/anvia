import { describe, expect, it } from "vitest";
import {
  AgentBuilder,
  AssistantContent,
  assertCompletionRequestSupported,
  CompletionCapabilityError,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionRequest,
  CompletionRequestBuilder,
  type CompletionResponse,
  type CompletionStreamEvent,
  Message,
  type StreamingCompletionModel,
  Usage,
  UserContent,
} from "../src/index";

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

  constructor(capabilities: Partial<CompletionModelCapabilities> = {}) {
    this.capabilities = { ...fullCapabilities, streaming: false, ...capabilities };
  }

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    return {
      choice: [AssistantContent.text("ok")],
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

  it("CompletionRequestBuilder.send enforces capabilities before model calls", async () => {
    const model = new QueueModel({ tools: false });

    await expect(
      new CompletionRequestBuilder(model, Message.user("hello"))
        .tools([{ name: "lookup", description: "Lookup", parameters: { type: "object" } }])
        .send(),
    ).rejects.toThrow("test:test-model does not support tool definitions.");
    expect(model.requests).toHaveLength(0);
  });

  it("PromptRequest.send enforces capabilities before model calls", async () => {
    const model = new QueueModel({ imageInput: false });
    const agent = new AgentBuilder("agent", model).build();

    await expect(
      agent.prompt(Message.user([UserContent.imageUrl("https://example.com/a.png")])).send(),
    ).rejects.toThrow("test:test-model does not support image input.");
    expect(model.requests).toHaveLength(0);
  });

  it("PromptRequest.stream enforces streaming capabilities before model calls", async () => {
    const model = new StreamingQueueModel({ streaming: false });
    const agent = new AgentBuilder("agent", model).build();

    await expect(collect(agent.prompt("hello").stream())).rejects.toThrow(
      "This completion model does not support streaming",
    );
    expect(model.requests).toHaveLength(0);
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
