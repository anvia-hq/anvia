import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AssistantContent,
  type CompletionModel,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  createHook,
  createMiddleware,
  createResolvedAgent,
  createTool,
  getResolvedAgentOptions,
  type McpServer,
  type McpTool,
  Message,
  type StreamingCompletionModel,
  type ToolIndex,
  Usage,
  withInternalAgentRunOptions,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
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
    if (response === undefined) throw new Error("No queued response");
    return response;
  }
}

class StreamingQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
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

  constructor(private readonly responses: CompletionModelStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No queued response");
    yield* response;
  }
}

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return { choice, usage: Usage.empty(), rawResponse: {} };
}

function successfulTextStream(text: string): CompletionModelStreamEvent[] {
  return [
    { type: "text_delta", delta: text },
    {
      type: "final",
      response: {
        ...response([AssistantContent.text(text)]),
        finishReason: "stop",
      },
    },
  ];
}

describe("Agent MCP registrations", () => {
  it("registers immutable MCP snapshots and executes their tools", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "mcp_add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const server = fakeMcpServer();
    const agent = new Agent({ id: "test-agent", model, mcpServers: [server] });

    await expect(agent.generate({ prompt: "add" })).resolves.toMatchObject({ output: "7" });

    expect(Object.isFrozen(agent.mcpServers)).toBe(true);
    expect(Object.isFrozen(agent.mcpServers[0])).toBe(true);
    expect(Object.isFrozen(agent.mcpServers[0]?.tools)).toBe(true);
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("mcp_add");
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "mcp_add",
          content: [{ type: "text", text: "7" }],
        },
      ]),
    );
  });

  it("preserves MCP registrations through resolved Agent cloning", () => {
    const agent = new Agent({
      id: "source",
      model: new QueueModel([]),
      mcpServers: [fakeMcpServer("Server metadata that is not an instruction")],
      instructions: "Application instructions only",
    });
    const clone = createResolvedAgent({
      ...getResolvedAgentOptions(agent),
      id: "clone",
    });

    expect(clone.mcpServers).toHaveLength(1);
    expect(clone.mcpServers[0]?.instructions).toBe("Server metadata that is not an instruction");
    expect(clone.instructions).toBe("Application instructions only");
    expect(clone.getTool("mcp_add")).toBeDefined();
    expect(clone.tools.filter((tool) => tool.name === "mcp_add")).toHaveLength(1);
  });

  it("applies middleware to MCP tool results", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "mcp_add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      mcpServers: [fakeMcpServer()],
      middlewares: [
        createMiddleware({
          onToolOutput({ result }) {
            return `mcp:${result}`;
          },
        }),
      ],
    });

    await expect(agent.generate({ prompt: "add" })).resolves.toMatchObject({ output: "done" });
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "mcp_add",
          content: [{ type: "text", text: "mcp:7" }],
        },
      ]),
    );
  });

  it("preserves hooks while streaming MCP tool execution", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "mcp_add",
          argumentsDelta: '{"x":2,"y":5}',
        },
        {
          type: "final",
          response: {
            ...response([AssistantContent.toolCall("call_1", "mcp_add", { x: 2, y: 5 })]),
            finishReason: "tool-calls",
          },
        },
      ],
      successfulTextStream("7"),
    ]);
    const events: string[] = [];
    const hook = createHook({
      onToolCall({ toolName, args }) {
        events.push(`call:${toolName}:${args}`);
      },
      onToolResult({ toolName, result }) {
        events.push(`result:${toolName}:${result}`);
      },
    });
    const agent = new Agent({ id: "test-agent", model, mcpServers: [fakeMcpServer()] });

    const streamEvents = await collect(
      agent.stream({ prompt: "add", ...withInternalAgentRunOptions({}, { hook }) }),
    );

    expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("mcp_add");
    expect(streamEvents.at(-1)).toMatchObject({ type: "response", output: "7" });
    expect(events).toEqual(['call:mcp_add:{"x":2,"y":5}', "result:mcp_add:7"]);
  });

  it("preserves MCP tool approval requirements", async () => {
    let executed = false;
    const base = createTool({
      name: "mcp_guarded",
      description: "Guarded MCP action",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute() {
        executed = true;
        return "approved";
      },
    });
    const tool: McpTool = {
      ...base,
      mcp: { serverName: "guarded", remoteName: "guarded" },
    };
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "mcp_guarded", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new Agent({
      id: "approval",
      model,
      mcpServers: [{ name: "guarded", tools: [tool] }],
    });

    const pending = await agent.generate({ prompt: "run guarded" });
    expect(pending).toMatchObject({
      type: "interaction",
      interaction: { type: "tool-approval", toolName: "mcp_guarded" },
    });
    expect(executed).toBe(false);
    if (pending.type !== "interaction") throw new Error("Expected suspension");
    await expect(
      agent.generate({
        continuation: pending.continuation,
        response: { type: "tool-approval", approved: true },
      }),
    ).resolves.toMatchObject({
      output: "done",
    });
    expect(executed).toBe(true);
  });

  it("rejects collisions across local, MCP, skill, provider, and indexed tools", () => {
    const local = createNamedTool("shared");
    const mcp = fakeMcpServer(undefined, "shared");
    const provider = { kind: "provider" as const, provider: "test", name: "shared" };
    const index: ToolIndex = {
      kind: "tool-index",
      tools: [createNamedTool("shared")],
      topK: 1,
      async search() {
        return [];
      },
    };
    const model = new QueueModel([]);

    expect(() => new Agent({ id: "local-mcp", model, tools: [local], mcpServers: [mcp] })).toThrow(
      'Tool name collision for "shared"',
    );
    expect(
      () => new Agent({ id: "mcp-provider", model, tools: [provider], mcpServers: [mcp] }),
    ).toThrow('Tool name collision for "shared"');
    expect(() => new Agent({ id: "mcp-index", model, tools: [index], mcpServers: [mcp] })).toThrow(
      'Tool name collision for "shared"',
    );
    expect(
      () =>
        new Agent({
          id: "local-skill",
          model,
          tools: [local],
          skills: { skills: [], tools: [createNamedTool("shared")], instructions: "" },
        }),
    ).toThrow('Duplicate skill tool name "shared"');
  });

  it("requires MCP tools to enter through mcpServers and rejects duplicate servers", () => {
    const model = new QueueModel([]);
    const server = fakeMcpServer();
    const mcpTool = server.tools[0];
    if (mcpTool === undefined) throw new Error("Expected MCP fixture tool");

    expect(() => new Agent({ id: "wrong-boundary", model, tools: [mcpTool] })).toThrow(
      "must be registered through Agent.mcpServers",
    );
    expect(
      () =>
        new Agent({
          id: "duplicate-servers",
          model,
          mcpServers: [server, { name: server.name, tools: [] }],
        }),
    ).toThrow('Duplicate MCP server name "math"');
  });
});

function fakeMcpServer(instructions?: string, toolName = "mcp_add"): McpServer {
  const base = createTool({
    name: toolName,
    description: "Add numbers from MCP",
    inputSchema: z.object({ x: z.number(), y: z.number() }),
    outputSchema: z.number(),
    execute: ({ x, y }) => x + y,
  });
  const tool: McpTool = Object.freeze({
    ...base,
    mcp: Object.freeze({ serverName: "math", remoteName: "add" }),
  });
  let server: McpServer = {
    name: "math",
    tools: Object.freeze([tool]),
  };
  if (instructions !== undefined) server = { ...server, instructions };
  return Object.freeze(server);
}

function createNamedTool(name: string) {
  return createTool({
    name,
    description: name,
    inputSchema: z.object({}),
    execute: () => name,
  });
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}
