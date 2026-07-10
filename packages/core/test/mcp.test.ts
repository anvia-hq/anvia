import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  connectMcp,
  createHook,
  createTool,
  createToolMiddleware,
  type McpClient,
  type McpConnection,
  type McpServer,
  Message,
  type StreamingCompletionModel,
  Usage,
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

class StreamingQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
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

  constructor(private readonly responses: CompletionStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    yield* response;
  }
}

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

describe("MCP tools", () => {
  it("connects once and maps MCP tool definitions", async () => {
    const client = fakeMcpClient({
      tools: [
        {
          name: "add",
          description: "Add numbers",
          inputSchema: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" } },
            required: ["x", "y"],
          },
        },
      ],
      result: { content: [{ type: "text", text: "7" }] },
    });
    const server = await connectMcp(fakeConnection("math", client));

    expect(client.listToolsCalls).toBe(1);
    expect(server.name).toBe("math");
    expect(await server.tools[0]?.definition("")).toEqual({
      name: "add",
      description: "Add numbers",
      parameters: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
      },
    });
  });

  it("closes the MCP client when listing tools fails", async () => {
    const client = fakeMcpClient({
      tools: [],
      result: { content: [{ type: "text", text: "unused" }] },
      listToolsError: new Error("list failed"),
    });

    await expect(connectMcp(fakeConnection("broken", client))).rejects.toThrow("list failed");

    expect(client.connectCalls).toBe(1);
    expect(client.listToolsCalls).toBe(1);
    expect(client.closeCalls).toBe(1);
  });

  it("preserves the list tools error when MCP close also fails", async () => {
    const client = fakeMcpClient({
      tools: [],
      result: { content: [{ type: "text", text: "unused" }] },
      listToolsError: new Error("list failed"),
      closeError: new Error("close failed"),
    });

    await expect(connectMcp(fakeConnection("broken", client))).rejects.toThrow("list failed");

    expect(client.closeCalls).toBe(1);
  });

  it("forwards MCP tool calls with JSON object arguments", async () => {
    const client = fakeMcpClient({
      tools: [
        {
          name: "add",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: { content: [{ type: "text", text: "7" }] },
    });
    const server = await connectMcp(fakeConnection("math", client));

    await expect(server.tools[0]?.call({ x: 2, y: 5 })).resolves.toBe("7");
    expect(client.callToolCalls).toEqual([{ name: "add", arguments: { x: 2, y: 5 } }]);
  });

  it("omits null MCP arguments and rejects non-object arguments", async () => {
    const client = fakeMcpClient({
      tools: [
        {
          name: "ping",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: { content: [{ type: "text", text: "pong" }] },
    });
    const server = await connectMcp(fakeConnection("ping", client));

    await expect(server.tools[0]?.call(null)).resolves.toBe("pong");
    expect(client.callToolCalls).toEqual([{ name: "ping" }]);
    await expect(server.tools[0]?.call("bad")).rejects.toThrow(
      "MCP tool arguments must be a JSON object",
    );
  });

  it("maps direct MCP toolResult payloads", async () => {
    const stringClient = fakeMcpClient({
      tools: [
        {
          name: "string_result",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: { toolResult: "done", content: [] },
    });
    const objectClient = fakeMcpClient({
      tools: [
        {
          name: "object_result",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: { toolResult: { ok: true }, content: [] },
    });
    const undefinedClient = fakeMcpClient({
      tools: [
        {
          name: "undefined_result",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: { toolResult: undefined, content: [] },
    });

    await expect(
      (await connectMcp(fakeConnection("string", stringClient))).tools[0]?.call({}),
    ).resolves.toBe("done");
    await expect(
      (await connectMcp(fakeConnection("object", objectClient))).tools[0]?.call({}),
    ).resolves.toBe('{"ok":true}');
    await expect(
      (await connectMcp(fakeConnection("undefined", undefinedClient))).tools[0]?.call({}),
    ).resolves.toBe("undefined");
  });

  it("maps image and resource MCP tool results", async () => {
    const client = fakeMcpClient({
      tools: [
        {
          name: "read",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: {
        content: [
          { type: "image", mimeType: "image/png", data: "abc123" },
          {
            type: "resource",
            resource: {
              uri: "file:///tmp/report.txt",
              mimeType: "text/plain",
              text: "hello",
            },
          },
          {
            type: "resource",
            resource: {
              uri: "file:///tmp/blob.bin",
              blob: "ZGF0YQ==",
            },
          },
        ],
      },
    });
    const server = await connectMcp(fakeConnection("files", client));

    await expect(server.tools[0]?.call({})).resolves.toBe(
      "data:image/png;base64,abc123data:text/plain;file:///tmp/report.txt:hellofile:///tmp/blob.bin:ZGF0YQ==",
    );
  });

  it("throws for MCP error results and unsupported content", async () => {
    const errorClient = fakeMcpClient({
      tools: [
        {
          name: "fail",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: { isError: true, content: [{ type: "text", text: "denied" }] },
    });
    const errorServer = await connectMcp(fakeConnection("errors", errorClient));

    await expect(errorServer.tools[0]?.call({})).rejects.toThrow("denied");

    const fallbackErrorClient = fakeMcpClient({
      tools: [
        {
          name: "fallback_fail",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: { isError: true, content: [{ type: "image", mimeType: "image/png", data: "abc" }] },
    });
    const fallbackErrorServer = await connectMcp(
      fakeConnection("fallback-errors", fallbackErrorClient),
    );

    await expect(fallbackErrorServer.tools[0]?.call({})).rejects.toThrow(
      "MCP tool returned an error",
    );

    const unsupportedClient = fakeMcpClient({
      tools: [
        {
          name: "audio",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
      result: {
        content: [{ type: "audio", data: "abc", mimeType: "audio/wav" } as never],
      },
    });
    const unsupportedServer = await connectMcp(fakeConnection("audio", unsupportedClient));

    await expect(unsupportedServer.tools[0]?.call({})).rejects.toThrow(
      "Unsupported MCP tool result content",
    );
  });

  it("registers MCP tools with send", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "mcp_add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const agent = new AgentBuilder("test-agent", model).mcp([fakeMcpServer()]).build();

    await expect(agent.prompt("add").send()).resolves.toMatchObject({ output: "7" });

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

  it("applies tool result middleware to MCP tools", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "mcp_add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .mcp([fakeMcpServer()])
      .toolMiddleware(
        createToolMiddleware({
          onResult({ result }) {
            return `mcp:${result}`;
          },
        }),
      )
      .build();

    await expect(agent.prompt("add").send()).resolves.toMatchObject({ output: "done" });

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

  it("registers MCP tools with stream and preserves hooks", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "mcp_add",
          argumentsDelta: '{"x":2,"y":5}',
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const events: string[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .mcp([fakeMcpServer()])
      .hook(
        createHook({
          onToolCall({ toolName, args }) {
            events.push(`call:${toolName}:${args}`);
          },
          onToolResult({ toolName, result }) {
            events.push(`result:${toolName}:${result}`);
          },
        }),
      )
      .build();

    const streamEvents = await collect(agent.prompt("add").stream());

    expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("mcp_add");
    expect(streamEvents.at(-1)).toMatchObject({ type: "final", output: "7" });
    expect(events).toEqual(['call:mcp_add:{"x":2,"y":5}', "result:mcp_add:7"]);
  });
});

function fakeConnection(name: string, client: FakeMcpClient): McpConnection {
  return {
    name,
    async connect(): Promise<McpClient> {
      client.connectCalls += 1;
      return client;
    },
  };
}

function fakeMcpServer(): McpServer {
  return {
    name: "math",
    tools: [
      createTool({
        name: "mcp_add",
        description: "Add numbers from MCP",
        input: z.object({
          x: z.number(),
          y: z.number(),
        }),
        output: z.number(),
        execute: ({ x, y }) => x + y,
      }),
    ],
    async close() {},
  };
}

type FakeMcpClient = McpClient & {
  connectCalls: number;
  listToolsCalls: number;
  callToolCalls: { name: string; arguments?: Record<string, unknown> }[];
  closeCalls: number;
};

function fakeMcpClient(options: {
  tools: Awaited<ReturnType<McpClient["listTools"]>>["tools"];
  result: Awaited<ReturnType<McpClient["callTool"]>>;
  listToolsError?: Error | undefined;
  closeError?: Error | undefined;
}): FakeMcpClient {
  return {
    connectCalls: 0,
    listToolsCalls: 0,
    callToolCalls: [],
    closeCalls: 0,
    async listTools() {
      this.listToolsCalls += 1;
      if (options.listToolsError !== undefined) {
        throw options.listToolsError;
      }
      return { tools: options.tools };
    },
    async callTool(params) {
      this.callToolCalls.push(params);
      return options.result;
    },
    async close() {
      this.closeCalls += 1;
      if (options.closeError !== undefined) {
        throw options.closeError;
      }
    },
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}
