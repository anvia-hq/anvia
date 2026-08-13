import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createMiddleware,
  createObserver,
  createTool,
  defineGuardrailPolicy,
  defineInputGuardrail,
  MaxTurnsError,
  type Tool,
  type ToolSearchDocument,
  ToolSet,
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
  input: z.object({
    x: z.number(),
    y: z.number(),
  }),
  output: z.number(),
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
    const dynamicToolIndex = emptyIndex<ToolSearchDocument>();
    const skillTool = { ...addTool, name: "skill_add" };
    const mcpTool = { ...addTool, name: "mcp_add" };
    const tools = [addTool];
    const context = [{ id: "policy", text: "Keep answers short." }];

    const agent = new Agent({
      id: " support ",
      model,
      name: "Support",
      instructions: "Help customers.",
      context,
      tools,
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
      dynamicContexts: [{ index: dynamicContextIndex, topK: 2, threshold: 0.5 }],
      dynamicTools: [{ index: dynamicToolIndex, topK: 3 }],
      outputSchema: z.object({ answer: z.string() }),
    });

    tools.push(skillTool);
    context.push({ id: "late", text: "Late context." });

    expect(agent.id).toBe("support");
    expect(agent.instructions).toBe("Help customers.\n\nUse the loaded skills.");
    expect(agent.staticContext).toEqual([{ id: "policy", text: "Keep answers short." }]);
    expect(agent.toolSet.values().map((tool) => tool.name)).toEqual([
      "add",
      "mcp_add",
      "skill_add",
    ]);
    expect(agent.defaultMaxTurns).toBe(4);
    expect(agent.middlewares).toEqual([middleware]);
    expect(agent.observers).toEqual([{ observer }, { observer, failOnObserverError: true }]);
    expect(agent.dynamicContexts).toEqual([
      { index: dynamicContextIndex, options: { topK: 2, threshold: 0.5 } },
    ]);
    expect(agent.dynamicTools).toEqual([{ index: dynamicToolIndex, options: { topK: 3 } }]);
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

  it("uses shared tool set updates made after agent creation", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const toolSet = new ToolSet();
    const agent = new AgentBuilder("test-agent", model)
      .useToolSet(toolSet)
      .defaultMaxTurns(1)
      .build();

    toolSet.addTool(addTool);

    await expect(agent.generate("add numbers")).resolves.toMatchObject({ output: "done" });
    expect(model.requests[0]?.tools).toEqual([expect.objectContaining({ name: "add" })]);
  });

  it("isolates built agents from later builder collection changes", () => {
    const model = new QueueModel([]);
    const builder = new AgentBuilder("test-agent", model).context("initial context");
    const agent = builder.build();
    const dynamicContextIndex = emptyIndex<unknown>();
    const dynamicToolIndex = emptyIndex<ToolSearchDocument>();

    builder
      .context("late context")
      .dynamicContext(dynamicContextIndex, { topK: 1 })
      .dynamicTools(dynamicToolIndex, { topK: 1 })
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

    expect(agent.staticContext).toEqual([{ id: "static_doc_0", text: "initial context" }]);
    expect(agent.middlewares).toHaveLength(0);
    expect(agent.observers).toHaveLength(0);
    expect(agent.guardrails).toHaveLength(0);
    expect(agent.dynamicContexts).toHaveLength(0);
    expect(agent.dynamicTools).toHaveLength(0);
  });

  it("copies existing builder tools into a shared tool set", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const toolSet = new ToolSet();
    const agent = new AgentBuilder("test-agent", model)
      .tools([addTool])
      .useToolSet(toolSet)
      .defaultMaxTurns(1)
      .build();

    expect(toolSet.get("add")).toBe(addTool);
    await expect(agent.generate("add numbers")).resolves.toMatchObject({ output: "done" });
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
    const toolSet = ToolSet.fromTools([first, second]);

    await expect(toolSet.call("ask_one", JSON.stringify({ prompt: "run" }))).resolves.toBe("one");
    await expect(toolSet.call("ask_two", JSON.stringify({ prompt: "run" }))).resolves.toBe("two");
  });
});
