import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  CompletionRequestBuilder,
  type CompletionResponse,
  type CompletionStreamEvent,
  createCompletion,
  createTool,
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

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
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
  it("partitions unified completion tools into local and provider collections", () => {
    const model = new ProviderToolModel();
    const request = new CompletionRequestBuilder(model, Message.user("research"))
      .tools([
        { name: "local", description: "Local tool", parameters: { type: "object" } },
        searchTool,
      ])
      .build();

    expect(request.tools).toEqual([
      { name: "local", description: "Local tool", parameters: { type: "object" } },
    ]);
    expect(request.providerTools).toEqual([searchTool]);
  });

  it("accepts provider tools in createCompletion", async () => {
    const model = new ProviderToolModel();

    const result = await createCompletion(model, {
      input: "research",
      tools: [searchTool],
    });

    expect(model.requests[0]).toMatchObject({
      tools: [],
      providerTools: [searchTool],
    });
    expect(result.response.sources).toEqual([{ type: "url", url: "https://example.com" }]);
  });

  it("keeps provider tools out of the local Agent ToolSet", async () => {
    const model = new ProviderToolModel();
    const localTool = createTool({
      name: "local",
      description: "Local tool",
      input: z.object({}),
      execute: () => "done",
    });
    const agent = new AgentBuilder("researcher", model).tools([localTool, searchTool]).build();

    const result = await agent.generate("research");

    expect(agent.toolSet.get("local")).toBe(localTool);
    expect(agent.toolSet.get("web_search")).toBeUndefined();
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
      input: z.object({}),
      execute: () => "done",
    });
    const agent = new Agent({ id: "researcher", model, tools: [localTool, searchTool] });

    await agent.generate("research");

    expect(agent.toolSet.values()).toEqual([localTool]);
    expect(agent.providerTools).toEqual([searchTool]);
    expect(model.requests[0]?.providerTools).toEqual([searchTool]);
  });

  it("rejects provider tools when the model does not advertise support", async () => {
    const model = new ProviderToolModel();
    model.capabilities.providerTools = false;

    await expect(
      createCompletion(model, {
        input: "research",
        tools: [searchTool],
      }),
    ).rejects.toThrow("does not support provider-executed tools");
  });

  it("propagates and aggregates provider artifacts through Agent streams", async () => {
    const model = new StreamingProviderToolModel();
    const agent = new AgentBuilder("researcher", model).tools([searchTool]).build();

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
      sources: [{ type: "url", url: "https://example.com" }],
      providerToolCalls: [{ id: "search_1", name: "web_search", status: "completed" }],
    });
  });
});
