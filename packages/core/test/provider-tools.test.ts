import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createCompletionRequest } from "../src/internal/completion-request";
import {
  Agent,
  AssistantContent,
  assertCompleted,
  type CompletionModel,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionTool,
  createTool,
  generateCompletion,
  Message,
  type ProviderTool,
  type StreamingCompletionModel,
  Usage,
} from "./helpers/imports";

const searchTool: ProviderTool = {
  kind: "provider",
  provider: "test",
  name: "web_search",
  configuration: { allowed_domains: ["example.com"] },
};

class ProviderToolModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test-model";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
    providerTools: true,
  };
  readonly requests: CompletionRequest[] = [];

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    return {
      choice: [AssistantContent.text("ok")],
      usage: Usage.empty(),
      rawResponse: {},
      sources: [{ type: "url", url: "https://example.com" }],
      providerToolCalls: [{ id: "search_1", name: "web_search", status: "completed" }],
    };
  }
}

class StreamingProviderToolModel extends ProviderToolModel implements StreamingCompletionModel {
  override readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
    providerTools: true,
  };

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    const source = { type: "url" as const, url: "https://example.com" };
    const toolCall = { id: "search_1", name: "web_search", status: "completed" };
    yield { type: "source", source };
    yield { type: "provider_tool_call", toolCall };
    yield { type: "text_delta", delta: "ok" };
    yield {
      type: "final",
      response: {
        choice: [AssistantContent.text("ok")],
        usage: Usage.empty(),
        rawResponse: {},
        sources: [source],
        providerToolCalls: [toolCall],
      },
    };
  }
}

describe("provider-executed tools", () => {
  it("creates a normalized request with copied collections and every optional field", () => {
    const model = new ProviderToolModel();
    const history = [Message.system("system"), Message.user("research")];
    const documents = [{ id: "policy", text: "Refunds take 30 days." }];
    const localTool: CompletionTool = {
      name: "local",
      description: "Local tool",
      parameters: { type: "object" },
    };
    const tools = [localTool, searchTool];
    const outputSchema = { type: "object", properties: { answer: { type: "string" } } };
    const providerOptions = { seed: 42 };

    const request = createCompletionRequest(history, {
      model,
      modelOverride: "override-model",
      instructions: "Use the policy.",
      documents,
      tools,
      temperature: 0.2,
      maxTokens: 256,
      toolChoice: "required",
      outputSchema,
      providerOptions,
    });

    expect(request).toEqual({
      chatHistory: history,
      model: "override-model",
      instructions: "Use the policy.",
      documents,
      tools: [localTool],
      providerTools: [searchTool],
      temperature: 0.2,
      maxTokens: 256,
      toolChoice: "required",
      outputSchema,
      providerOptions,
    });
    expect(request.chatHistory).not.toBe(history);
    expect(request.documents).not.toBe(documents);
    expect(request.tools).not.toBe(tools);
    expect(request.providerTools).not.toBe(tools);
  });

  it("partitions unified completion tools into local and provider collections", () => {
    const model = new ProviderToolModel();
    const request = createCompletionRequest(Message.user("research"), {
      model,
      tools: [
        { name: "local", description: "Local tool", parameters: { type: "object" } },
        searchTool,
      ],
    });

    expect(request.tools).toEqual([
      { name: "local", description: "Local tool", parameters: { type: "object" } },
    ]);
    expect(request.providerTools).toEqual([searchTool]);
  });

  it("accepts provider tools in generateCompletion", async () => {
    const model = new ProviderToolModel();

    const result = await generateCompletion({
      model,
      prompt: "research",
      tools: [searchTool],
    });

    expect(model.requests[0]).toMatchObject({
      tools: [],
      providerTools: [searchTool],
    });
    expect(result.sources).toEqual([{ type: "url", url: "https://example.com" }]);
  });

  it("keeps provider tools out of the local Agent tools", async () => {
    const model = new ProviderToolModel();
    const localTool = createTool({
      name: "local",
      description: "Local tool",
      inputSchema: z.object({}),
      execute: () => "done",
    });
    const agent = new Agent({ id: "researcher", model, tools: [localTool, searchTool] });

    const result = await agent.generate("research");
    assertCompleted(result);

    expect(agent.getTool("local")).toBe(localTool);
    expect(agent.getTool("web_search")).toBeUndefined();
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["local"]);
    expect(model.requests[0]?.providerTools).toEqual([searchTool]);
    expect(result.sources).toEqual([{ type: "url", url: "https://example.com" }]);
    expect(result.providerToolCalls).toEqual([
      { id: "search_1", name: "web_search", status: "completed" },
    ]);
  });

  it("partitions provider tools passed to the public Agent constructor", async () => {
    const model = new ProviderToolModel();
    const localTool = createTool({
      name: "local",
      description: "Local tool",
      inputSchema: z.object({}),
      execute: () => "done",
    });
    const agent = new Agent({ id: "researcher", model, tools: [localTool, searchTool] });

    await agent.generate("research");

    expect(agent.tools).toEqual([localTool]);
    expect(model.requests[0]?.providerTools).toEqual([searchTool]);
  });

  it("rejects provider tools when the model does not advertise support", async () => {
    const model = new ProviderToolModel();
    model.capabilities.providerTools = false;

    await expect(
      generateCompletion({
        model,
        prompt: "research",
        tools: [searchTool],
      }),
    ).rejects.toThrow("does not support provider-executed tools");
  });

  it("propagates and aggregates provider artifacts through Agent streams", async () => {
    const model = new StreamingProviderToolModel();
    const agent = new Agent({ id: "researcher", model, tools: [searchTool] });

    const events = [];
    for await (const event of agent.stream("research")) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "source",
      turn: 1,
      source: { type: "url", url: "https://example.com" },
    });
    expect(events).toContainEqual({
      type: "provider_tool_call",
      turn: 1,
      toolCall: { id: "search_1", name: "web_search", status: "completed" },
    });
    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: {
        sources: [{ type: "url", url: "https://example.com" }],
        providerToolCalls: [{ id: "search_1", name: "web_search", status: "completed" }],
      },
    });
  });
});
