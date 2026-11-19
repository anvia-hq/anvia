import { describe, expect, it, vi } from "vitest";
import { Agent, type AgentStreamEvent } from "../src/agent";
import {
  Usage,
  type CompletionRequest,
  type CompletionResponse,
  type StreamingCompletionModel,
} from "../src/completion";
import type { AnyTool, ToolIndex } from "../src/tool";

function tool(name: string): AnyTool {
  return {
    name,
    definition: () => ({
      name,
      description: `${name} tool`,
      parameters: { type: "object", properties: {} },
    }),
    call: async () => "ok",
  };
}

function indexWith(results: Array<{ toolName: string; score: number }>): ToolIndex {
  const names = [...new Set(results.map((result) => result.toolName))];
  const tools = names.map((name) => tool(name));
  return {
    kind: "tool-index",
    tools,
    topK: 3,
    search: async () =>
      results.map((result) => ({
        id: result.toolName,
        score: result.score,
        document: {
          toolName: result.toolName,
          definition: {
            name: result.toolName,
            description: `${result.toolName} tool`,
            parameters: { type: "object", properties: {} },
          },
          text: result.toolName,
        },
      })),
  };
}

class StreamingModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "streaming";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly collect: (request: CompletionRequest) => CompletionResponse) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    return this.collect(request);
  }

  async *streamCompletion(request: CompletionRequest) {
    this.requests.push(request);
    const response = this.collect(request);
    yield { type: "final" as const, response, usage: response.usage };
  }
}

const events = async (agent: Agent) => {
  const collected: AgentStreamEvent[] = [];
  for await (const event of agent.stream({ prompt: "refund an order" })) collected.push(event);
  return collected;
};

describe("tool_selection event", () => {
  it("reports the tools offered and the index matches behind them", async () => {
    const index = indexWith([
      { toolName: "issue_refund", score: 0.91 },
      { toolName: "update_address", score: 0.42 },
    ]);
    const model = new StreamingModel(() => ({
      choice: [{ type: "text", text: "done" }],
      usage: Usage.empty(),
      rawResponse: {},
    }));
    const agent = new Agent({ id: "support", model, tools: [tool("static_tool"), index] });

    const selection = (await events(agent)).find((event) => event.type === "tool_selection");

    expect(selection).toEqual({
      type: "tool_selection",
      turn: 1,
      tools: ["static_tool", "issue_refund", "update_address"],
      matches: [
        { toolName: "issue_refund", index: 0, score: 0.91 },
        { toolName: "update_address", index: 0, score: 0.42 },
      ],
    });
  });

  it("indexes matches by the index's position, not the offered order", async () => {
    const first = indexWith([{ toolName: "first_tool", score: 0.8 }]);
    const second = indexWith([{ toolName: "second_tool", score: 0.7 }]);
    const model = new StreamingModel(() => ({
      choice: [{ type: "text", text: "done" }],
      usage: Usage.empty(),
      rawResponse: {},
    }));
    const agent = new Agent({ id: "support", model, tools: [first, second] });

    const selection = (await events(agent)).find((event) => event.type === "tool_selection");

    expect(selection?.matches.map((match) => [match.toolName, match.index])).toEqual([
      ["first_tool", 0],
      ["second_tool", 1],
    ]);
  });

  it("stays absent when no index is involved", async () => {
    const model = new StreamingModel(() => ({
      choice: [{ type: "text", text: "done" }],
      usage: Usage.empty(),
      rawResponse: {},
    }));
    const agent = new Agent({ id: "support", model, tools: [tool("static_tool")] });

    expect((await events(agent)).some((event) => event.type === "tool_selection")).toBe(false);
  });

  it("stays absent when the index returns nothing", async () => {
    const model = new StreamingModel(() => ({
      choice: [{ type: "text", text: "done" }],
      usage: Usage.empty(),
      rawResponse: {},
    }));
    const agent = new Agent({ id: "support", model, tools: [indexWith([])] });

    expect((await events(agent)).some((event) => event.type === "tool_selection")).toBe(false);
  });

  it("searches once per turn with the turn's own text", async () => {
    const search = vi.fn(async (_options: { query: string }) => []);
    const model = new StreamingModel(() => ({
      choice: [{ type: "text", text: "done" }],
      usage: Usage.empty(),
      rawResponse: {},
    }));
    const agent = new Agent({ id: "support", model, tools: [{ ...indexWith([]), search }] });

    await events(agent);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0].query).toBe("refund an order");
  });
});
