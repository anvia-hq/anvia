import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getAgentToolState } from "../src/agent/agent";
import {
  Agent,
  AgentRunCancelledError,
  type AnyTool,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type ContextIndex,
  createContextIndex,
  createMiddleware,
  createObserver,
  createTool,
  defineGuardrailPolicy,
  defineInputGuardrail,
  isToolIndex,
  type JsonObject,
  MaxTurnsError,
  type Tool,
  type ToolIndex,
  type ToolSearchDocument,
  Usage,
  type VectorSearchIndex,
  type VectorSearchResult,
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
    providerTools: true,
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
    expect(Object.isFrozen(agent.middlewares)).toBe(true);
    expect(Object.isFrozen(agent.observers)).toBe(true);
    expect(Object.isFrozen(agent.guardrails)).toBe(true);
    expect(agent.outputSchema).toMatchObject({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    });
  });

  it("snapshots nested data options while preserving behavioral capabilities", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const document = {
      id: "policy",
      text: "Keep answers short.",
      additionalProps: { source: "initial" },
    };
    const additionalParams = { routing: { tier: "initial" } };
    const toolChoice = { type: "function" as const, name: "provider_search" };
    const providerTool = {
      kind: "provider" as const,
      provider: "test",
      name: "provider_search",
      configuration: { mode: "initial" },
    };
    const observer = createObserver({
      startRun() {
        return { end() {} };
      },
    });
    const observerRegistration = { observer, failOnObserverError: false };
    const inputGuardrail = defineInputGuardrail({
      id: "initial",
      check() {
        return undefined;
      },
    });
    const policy = defineGuardrailPolicy({ id: "policy", input: [inputGuardrail] });
    const memoryStore = {
      async load() {
        return [];
      },
      async append() {},
      async clear() {},
    };
    const agent = new Agent({
      id: "agent",
      model,
      context: [document],
      additionalParams,
      toolChoice,
      tools: [providerTool],
      observers: [observerRegistration],
      guardrails: policy,
      memory: { store: memoryStore },
    });

    document.additionalProps.source = "mutated";
    additionalParams.routing.tier = "mutated";
    toolChoice.name = "mutated";
    providerTool.configuration.mode = "mutated";
    observerRegistration.failOnObserverError = true;
    policy.input.push(
      defineInputGuardrail({
        id: "late",
        check() {
          return undefined;
        },
      }),
    );

    await agent.generate("hello");

    expect(agent.context).toEqual([
      {
        id: "policy",
        text: "Keep answers short.",
        additionalProps: { source: "initial" },
      },
    ]);
    expect(agent.additionalParams).toEqual({ routing: { tier: "initial" } });
    expect(agent.toolChoice).toEqual({ type: "function", name: "provider_search" });
    expect(agent.observers[0]?.failOnObserverError).toBe(false);
    expect(agent.guardrails[0]?.input).toEqual([inputGuardrail]);
    expect(model.requests[0]?.providerTools).toEqual([
      {
        kind: "provider",
        provider: "test",
        name: "provider_search",
        configuration: { mode: "initial" },
      },
    ]);
    expect(Object.isFrozen(agent.context[0])).toBe(true);
    expect(Object.isFrozen(agent.additionalParams as object)).toBe(true);
    expect(Object.isFrozen(agent.toolChoice as object)).toBe(true);
    expect(Object.isFrozen(agent.observers[0])).toBe(true);
    expect(Object.isFrozen(agent.guardrails[0]?.input)).toBe(true);
    expect(Object.isFrozen(agent.memory)).toBe(true);
    expect(Object.isFrozen(agent.memory?.options)).toBe(true);
    expect(getAgentToolState(agent)).not.toHaveProperty("toolsByName");
  });

  it("preserves own __proto__ JSON keys without changing the snapshot prototype", () => {
    const additionalParams = JSON.parse(
      '{"__proto__":{"injected":true},"safe":true}',
    ) as JsonObject;
    const agent = new Agent({
      id: "agent",
      model: new QueueModel([]),
      additionalParams,
    });

    expect(Object.hasOwn(agent.additionalParams as object, "__proto__")).toBe(true);
    expect(JSON.stringify(agent.additionalParams)).toBe(
      '{"__proto__":{"injected":true},"safe":true}',
    );
    expect(Object.getPrototypeOf(agent.additionalParams)).toBe(Object.prototype);
    expect(
      (Object.getPrototypeOf(agent.additionalParams) as Record<string, unknown>).injected,
    ).toBe(undefined);
  });

  it("copies null-prototype JSON dictionaries instead of retaining mutable aliases", () => {
    const additionalParams = Object.assign(Object.create(null) as JsonObject, {
      routing: "initial",
    });
    const agent = new Agent({
      id: "agent",
      model: new QueueModel([]),
      additionalParams,
    });

    additionalParams.routing = "mutated";

    expect(agent.additionalParams).toEqual({ routing: "initial" });
    expect(agent.additionalParams).not.toBe(additionalParams);
    expect(Object.isFrozen(agent.additionalParams as object)).toBe(true);
  });

  it("snapshots tool-index registration metadata", () => {
    const indexedTool = { ...addTool, name: "indexed" };
    const index = emptyToolIndex([indexedTool], 2);
    const agent = new Agent({ id: "agent", model: new QueueModel([]), tools: [index] });

    (index.tools as AnyTool[]).push({ ...addTool, name: "late" });
    (index as { topK: number }).topK = 9;

    const registered = getAgentToolState(agent).toolIndexes[0];
    expect(registered?.tools.map((tool) => tool.name)).toEqual(["indexed"]);
    expect(registered?.topK).toBe(2);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered?.tools)).toBe(true);
  });

  it("preserves class-based context-index getters and format methods", () => {
    class ClassContextIndex implements ContextIndex<string> {
      readonly kind = "context-index" as const;
      readonly index = emptyIndex<string>();

      get topK(): number {
        return 2;
      }

      format(result: VectorSearchResult<string>) {
        return { id: result.id, text: `class:${result.document}` };
      }
    }

    const agent = new Agent({
      id: "agent",
      model: new QueueModel([]),
      context: [new ClassContextIndex()],
    });
    const registered = agent.context[0] as ContextIndex<string>;

    expect(registered.topK).toBe(2);
    expect(
      registered.format?.({
        id: "doc",
        score: 1,
        document: "content",
      }),
    ).toEqual({ id: "doc", text: "class:content" });
  });

  it("snapshots class-based documents through their public fields", () => {
    class ClassDocument {
      get id() {
        return "class-doc";
      }

      get text() {
        return "class content";
      }

      get additionalProps() {
        return { source: "class" };
      }
    }
    const document = new ClassDocument();
    const agent = new Agent({ id: "agent", model: new QueueModel([]), context: [document] });

    expect(agent.context).toEqual([
      { id: "class-doc", text: "class content", additionalProps: { source: "class" } },
    ]);
    expect(agent.context[0]).not.toBe(document);
    expect(Object.isFrozen(agent.context[0])).toBe(true);
  });

  it("uses the existing max-turn default without requiring build", () => {
    const agent = new Agent({ id: "agent", model: new QueueModel([]) });

    expect(agent.defaultMaxTurns).toBe(20);
    expect(agent).not.toHaveProperty("build");
  });

  it("rejects invalid run limits before execution", () => {
    const model = new QueueModel([]);
    const agent = new Agent({ id: "agent", model });

    expect(() => new Agent({ id: "agent", model, maxTurns: Number.NaN })).toThrow(
      "maxTurns must be a nonnegative safe integer",
    );
    expect(() => agent.generate("hello", { toolConcurrency: Number.NaN })).toThrow(
      "toolConcurrency must be a positive safe integer",
    );
    expect(() => agent.stream("hello", { toolConcurrency: 0 })).toThrow(
      "toolConcurrency must be a positive safe integer",
    );
  });

  it("rejects duplicate executable names across tool indexes", () => {
    const first = emptyToolIndex([{ ...addTool, name: "shared" }]);
    const second = emptyToolIndex([{ ...addTool, name: "shared" }]);

    expect(
      () => new Agent({ id: "agent", model: new QueueModel([]), tools: [first, second] }),
    ).toThrow('Tool "shared" is registered by multiple tool indexes');
  });

  it("validates structurally supplied retrieval registrations", () => {
    const contextIndex = {
      ...createContextIndex(emptyIndex<string>(), { topK: 1 }),
      topK: Number.NaN,
    };
    const toolIndex = { ...emptyToolIndex([addTool]), threshold: Number.POSITIVE_INFINITY };

    expect(
      () => new Agent({ id: "agent", model: new QueueModel([]), context: [contextIndex] }),
    ).toThrow("topK must be a positive safe integer");
    expect(() => new Agent({ id: "agent", model: new QueueModel([]), tools: [toolIndex] })).toThrow(
      "threshold must be a finite number",
    );
    const malformedToolIndex = {
      kind: "tool-index",
      tools: [],
      topK: 1,
      async search() {
        return [];
      },
    } as unknown as ToolIndex;
    expect(isToolIndex(malformedToolIndex)).toBe(false);
    expect(
      () => new Agent({ id: "agent", model: new QueueModel([]), tools: [malformedToolIndex] }),
    ).toThrow("Invalid tool index");
  });

  it("resolves indexed tool definitions from the executable at request time", async () => {
    const dynamicTool: AnyTool = {
      name: "dynamic",
      definition(prompt) {
        return {
          name: "dynamic",
          description: `Current definition for ${prompt}`,
          parameters: { type: "object", properties: {}, additionalProperties: false },
        };
      },
      call() {
        return "ok";
      },
    };
    const index: ToolIndex = {
      ...emptyIndex<ToolSearchDocument>(),
      kind: "tool-index",
      tools: [dynamicTool],
      topK: 1,
      async search() {
        return [
          {
            id: "dynamic",
            score: 1,
            document: {
              toolName: "dynamic",
              definition: {
                name: "dynamic",
                description: "Stale embedded definition",
                parameters: { type: "object", properties: {} },
              },
              text: "dynamic",
            },
          },
        ];
      },
    };
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new Agent({ id: "agent", model, tools: [index] });

    await agent.generate("hello");

    expect(model.requests[0]?.tools).toEqual([
      expect.objectContaining({
        name: "dynamic",
        description: "Current definition for hello",
      }),
    ]);
  });

  it("registers documents and context indexes through Agent options", () => {
    const index = createContextIndex(emptyIndex<string>(), { topK: 2 });
    const agent = new Agent({
      id: "agent",
      model: new QueueModel([]),
      context: [
        { id: "policy", text: "Keep answers short." },
        index,
        { id: "generated", text: "Generated id" },
      ],
    });

    expect(agent.context).toEqual([
      { id: "policy", text: "Keep answers short." },
      index,
      { id: "generated", text: "Generated id" },
    ]);
    expect(Object.isFrozen(agent.context)).toBe(true);
    expect(Object.isFrozen(index)).toBe(true);
  });
});

describe("Agent.asTool", () => {
  it("stores a stable trimmed agent id", () => {
    const model = new QueueModel([]);
    const agent = new Agent({ id: " support ", model });

    expect(agent.id).toBe("support");
  });

  it("rejects empty agent ids", () => {
    const model = new QueueModel([]);

    expect(() => new Agent({ id: "", model })).toThrow(TypeError);
    expect(() => new Agent({ id: "   ", model })).toThrow(TypeError);
    expect(() => new Agent({ id: undefined as unknown as string, model })).toThrow(TypeError);
  });

  it("creates a tool definition from an agent", async () => {
    const model = new QueueModel([]);
    const agent = new Agent({
      id: "test-agent",
      model,
      description: "Answer support questions.",
    });
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
    const agent = new Agent({ id: "test-agent", model });
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

  it("finalizes a child run when an agent tool cannot expose its pending approval", async () => {
    let observedError: unknown;
    const guardedTool = createTool({
      name: "guarded",
      description: "Run a guarded operation",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute: () => "approved",
    });
    const agent = new Agent({
      id: "child",
      model: new QueueModel([response([AssistantContent.toolCall("call_1", "guarded", {})])]),
      tools: [guardedTool],
      observers: [
        createObserver({
          startRun() {
            return {
              end() {},
              error({ error }) {
                observedError = error;
              },
            };
          },
        }),
      ],
    });

    await expect(agent.asTool({ name: "ask_child" }).call({ prompt: "run" })).rejects.toThrow(
      "cannot suspend for tool approval",
    );
    expect(observedError).toBeInstanceOf(AgentRunCancelledError);
  });

  it("applies maxTurns when provided", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 1, y: 1 })]),
      response([AssistantContent.toolCall("call_2", "add", { x: 2, y: 2 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [addTool], maxTurns: 3 });
    const tool = agent.asTool({ name: "ask_agent", maxTurns: 0 });

    await expect(tool.call({ prompt: "loop" })).rejects.toBeInstanceOf(MaxTurnsError);
  });

  it("registers multiple wrapped agents as distinct tools", async () => {
    const first = new Agent({
      id: "test-agent",
      model: new QueueModel([response([AssistantContent.text("one")])]),
    }).asTool({ name: "ask_one" });
    const second = new Agent({
      id: "test-agent",
      model: new QueueModel([response([AssistantContent.text("two")])]),
    }).asTool({ name: "ask_two" });
    await expect(first.call({ prompt: "run" })).resolves.toBe("one");
    await expect(second.call({ prompt: "run" })).resolves.toBe("two");
  });
});
