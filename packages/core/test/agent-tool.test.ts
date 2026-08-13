import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentBuilder,
  type AnyTool,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createContextIndex,
  createMiddleware,
  createObserver,
  createTool,
  defineGuardrailPolicy,
  defineInputGuardrail,
  MaxTurnsError,
  type Tool,
  type ToolIndex,
  type ToolSearchDocument,
  Usage,
  type VectorSearchIndex,
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

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

const addTool = createTool({
  name: "add",
  description: "Add numbers",
  inputSchema: z.object({
    x: z.number(),
    y: z.number(),
  }),
  outputSchema: z.number(),
  execute: ({ x, y }) => x + y,
});

const searchTool: Tool<{ query: string; topK?: number }, unknown> = {
  name: "search",
  definition() {
    return {
      name: "search",
      description: "Search documents",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          topK: { type: "number" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    };
  },
  call() {
    return [];
  },
};

function emptyIndex<T>(): VectorSearchIndex<T> {
  return {
    async search() {
      return [];
    },
    async searchIds() {
      return [];
    },
    asTool() {
      return searchTool;
    },
  };
}

function emptyToolIndex(tools: AnyTool[] = [], topK = 1): ToolIndex {
  return {
    ...emptyIndex<ToolSearchDocument>(),
    kind: "tool-index",
    tools,
    topK,
  };
}

describe("Agent construction", () => {
  it("normalizes the public options into ready-to-run agent state", () => {
    const model = new QueueModel([]);
    const middleware = createMiddleware({});
    const observer = createObserver({
      startRun() {
        return { end() {} };
      },
    });
    const dynamicContextIndex = emptyIndex<unknown>();
    const indexedTool = { ...addTool, name: "indexed_add" };
    const toolIndex = emptyToolIndex([indexedTool], 3);
    const skillTool = { ...addTool, name: "skill_add" };
    const mcpTool = { ...addTool, name: "mcp_add" };
    const tools = [addTool];
    const context = [{ id: "policy", text: "Keep answers short." }];

    const agent = new Agent({
      id: " support ",
      model,
      name: "Support",
      instructions: "Help customers.",
      context: [...context, createContextIndex(dynamicContextIndex, { topK: 2, threshold: 0.5 })],
      tools: [...tools, toolIndex],
      mcpServers: [{ name: "math", tools: [mcpTool], async close() {} }],
      skills: {
        skills: [],
        tools: [skillTool],
        instructions: "Use the loaded skills.",
      },
      temperature: 0.2,
      maxTokens: 500,
      maxTurns: 4,
      middlewares: [middleware],
      observers: [observer, { observer, failOnObserverError: true }],
      outputSchema: z.object({ answer: z.string() }),
    });

    tools.push(skillTool);
    context.push({ id: "late", text: "Late context." });

    expect(agent.id).toBe("support");
    expect(agent.instructions).toBe("Help customers.\n\nUse the loaded skills.");
    expect(agent.context).toEqual([
      { id: "policy", text: "Keep answers short." },
      createContextIndex(dynamicContextIndex, { topK: 2, threshold: 0.5 }),
    ]);
    expect(agent.tools.map((tool) => tool.name)).toEqual([
      "add",
      "mcp_add",
      "skill_add",
      "indexed_add",
    ]);
    expect(agent.defaultMaxTurns).toBe(4);
    expect(agent.middlewares).toEqual([middleware]);
    expect(agent.observers).toEqual([{ observer }, { observer, failOnObserverError: true }]);
    expect(agent.outputSchema).toMatchObject({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    });
  });

  it("uses the existing max-turn default without requiring build", () => {
    const agent = new Agent({ id: "agent", model: new QueueModel([]) });

    expect(agent.defaultMaxTurns).toBe(20);
    expect(agent).not.toHaveProperty("build");
  });

  it("registers documents and context indexes through AgentBuilder.context", () => {
    const index = createContextIndex(emptyIndex<string>(), { topK: 2 });
    const agent = new AgentBuilder("agent", new QueueModel([]))
      .context({ id: "policy", text: "Keep answers short." })
      .context(index)
      .context("Generated id")
      .build();

    expect(agent.context).toEqual([
      { id: "policy", text: "Keep answers short." },
      index,
      { id: "static_doc_1", text: "Generated id" },
    ]);
    expect(Object.isFrozen(agent.context)).toBe(true);
    expect(Object.isFrozen(index)).toBe(true);
  });
});

describe("Agent.asTool", () => {
  it("stores a stable trimmed agent id", () => {
    const model = new QueueModel([]);
    const agent = new AgentBuilder(" support ", model).build();

    expect(agent.id).toBe("support");
  });

  it("rejects empty agent ids", () => {
    const model = new QueueModel([]);

    expect(() => new AgentBuilder("", model)).toThrow(TypeError);
    expect(() => new AgentBuilder("   ", model)).toThrow(TypeError);
    expect(() => new AgentBuilder(undefined as unknown as string, model)).toThrow(TypeError);
  });

  it("creates a tool definition from an agent", async () => {
    const model = new QueueModel([]);
    const agent = new AgentBuilder("test-agent", model)
      .description("Answer support questions.")
      .build();
    const tool = agent.asTool({ name: "ask_support" });

    await expect(Promise.resolve(tool.definition(""))).resolves.toEqual({
      name: "ask_support",
      description: "Answer support questions.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The prompt to send to the agent.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    });
  });

  it("delegates tool calls to the wrapped agent", async () => {
    const model = new QueueModel([response([AssistantContent.text("delegated")])]);
    const agent = new AgentBuilder("test-agent", model).build();
    const tool = agent.asTool({
      name: "ask_agent",
      description: "Ask an agent.",
    });

    await expect(tool.call({ prompt: "do work" })).resolves.toBe("delegated");
    expect(model.requests[0]?.chatHistory.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "do work" }],
    });
  });

  it("applies maxTurns when provided", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 1, y: 1 })]),
      response([AssistantContent.toolCall("call_2", "add", { x: 2, y: 2 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new AgentBuilder("test-agent", model).tools([addTool]).defaultMaxTurns(3).build();
    const tool = agent.asTool({ name: "ask_agent", maxTurns: 0 });

    await expect(tool.call({ prompt: "loop" })).rejects.toBeInstanceOf(MaxTurnsError);
  });

  it("isolates built agents from later builder collection changes", () => {
    const model = new QueueModel([]);
    const builder = new AgentBuilder("test-agent", model).context("initial context");
    const agent = builder.build();
    const dynamicContextIndex = emptyIndex<unknown>();
    const toolIndex = emptyToolIndex([{ ...addTool, name: "late_tool" }]);

    builder
      .context("late context")
      .context(createContextIndex(dynamicContextIndex, { topK: 1 }))
      .tools([toolIndex])
      .middlewares([createMiddleware({})])
      .observe(
        createObserver({
          startRun() {
            return {
              end() {},
            };
          },
        }),
      )
      .guardrails(
        defineGuardrailPolicy({
          id: "late-policy",
          input: [
            defineInputGuardrail({
              id: "late-input",
              check(_context, { allow }) {
                return allow();
              },
            }),
          ],
        }),
      );

    expect(agent.context).toEqual([{ id: "static_doc_0", text: "initial context" }]);
    expect(agent.middlewares).toHaveLength(0);
    expect(agent.observers).toHaveLength(0);
    expect(agent.guardrails).toHaveLength(0);
    expect(agent.tools).toHaveLength(0);
  });

  it("registers multiple wrapped agents as distinct tools", async () => {
    const first = new AgentBuilder(
      "test-agent",
      new QueueModel([response([AssistantContent.text("one")])]),
    )
      .build()
      .asTool({ name: "ask_one" });
    const second = new AgentBuilder(
      "test-agent",
      new QueueModel([response([AssistantContent.text("two")])]),
    )
      .build()
      .asTool({ name: "ask_two" });
    await expect(first.call({ prompt: "run" })).resolves.toBe("one");
    await expect(second.call({ prompt: "run" })).resolves.toBe("two");
  });
});
