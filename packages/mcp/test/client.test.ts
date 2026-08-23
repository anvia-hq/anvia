import { readFileSync } from "node:fs";
import { ToolOutput } from "@anvia/core/tool";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpClient, McpClientGroup } from "../src";

const mcpPackageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

type ToolDefinition = {
  name: string;
  description?: string | undefined;
  inputSchema: { type: "object"; [key: string]: unknown };
};

type Behavior = {
  connect?: (options: unknown) => Promise<void> | undefined;
  connectError?: unknown;
  pages?: Array<{ tools: ToolDefinition[]; nextCursor?: string | undefined }>;
  listError?: unknown;
  result?: unknown;
  closeError?: unknown;
  serverInfo?: unknown;
  capabilities?: unknown;
  instructions?: string | undefined;
};

const sdk = vi.hoisted(() => {
  const behaviors: Behavior[] = [];
  const clients: SdkClient[] = [];
  const stdioTransports: Array<{ server: unknown }> = [];
  const httpTransports: Array<{ url: URL; options: Record<string, unknown> }> = [];

  class SdkClient {
    readonly metadata: unknown;
    readonly options: unknown;
    readonly behavior: Behavior;
    readonly connectCalls: Array<{ transport: unknown; options: unknown }> = [];
    readonly listToolsCalls: Array<{ params: unknown; options: unknown }> = [];
    readonly callToolCalls: Array<{ params: unknown; options: unknown }> = [];
    closeCalls = 0;
    page = 0;

    constructor(metadata: unknown, options?: unknown) {
      this.metadata = metadata;
      this.options = options;
      this.behavior = behaviors.shift() ?? {};
      clients.push(this);
    }

    async connect(transport: unknown, options: unknown): Promise<void> {
      this.connectCalls.push({ transport, options });
      await this.behavior.connect?.(options);
      if (this.behavior.connectError !== undefined) throw this.behavior.connectError;
    }

    async listTools(params: unknown, options: unknown) {
      this.listToolsCalls.push({ params, options });
      if (this.behavior.listError !== undefined) throw this.behavior.listError;
      if (params === undefined && this.behavior.pages !== undefined) {
        return {
          tools: this.behavior.pages.flatMap((page) => page.tools),
        };
      }
      return this.behavior.pages?.[this.page++] ?? { tools: [] };
    }

    async callTool(params: unknown, options: unknown) {
      this.callToolCalls.push({ params, options });
      return this.behavior.result ?? { content: [{ type: "text", text: "ok" }] };
    }

    getServerVersion() {
      return this.behavior.serverInfo;
    }

    getServerCapabilities() {
      return this.behavior.capabilities;
    }

    getInstructions() {
      return this.behavior.instructions;
    }

    async close(): Promise<void> {
      this.closeCalls += 1;
      if (this.behavior.closeError !== undefined) throw this.behavior.closeError;
    }
  }

  class StdioClientTransport {
    constructor(readonly server: unknown) {
      stdioTransports.push(this);
    }
  }

  class StreamableHTTPClientTransport {
    constructor(
      readonly url: URL,
      readonly options: Record<string, unknown>,
    ) {
      httpTransports.push(this);
    }
  }

  return {
    SdkClient,
    StdioClientTransport,
    StreamableHTTPClientTransport,
    behaviors,
    clients,
    stdioTransports,
    httpTransports,
  };
});

vi.mock("@modelcontextprotocol/client", () => ({
  Client: sdk.SdkClient,
  StreamableHTTPClientTransport: sdk.StreamableHTTPClientTransport,
}));
vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: sdk.StdioClientTransport,
}));

describe("McpClient", () => {
  beforeEach(() => {
    sdk.behaviors.length = 0;
    sdk.clients.length = 0;
    sdk.stdioTransports.length = 0;
    sdk.httpTransports.length = 0;
  });

  it("performs no I/O during construction and creates stdio on connect", async () => {
    const client = new McpClient({
      name: "filesystem",
      transport: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
        env: { MCP_TEST: "true" },
        cwd: "/workspace",
        stderr: "pipe",
        maxBufferSize: 1024,
      },
    });
    expect(sdk.clients).toHaveLength(0);
    expect(sdk.stdioTransports).toHaveLength(0);

    await client.connect();

    expect(sdk.clients[0]?.metadata).toEqual({
      name: "@anvia/mcp",
      version: mcpPackageVersion.version,
    });
    expect(sdk.stdioTransports[0]?.server).toEqual({
      command: "node",
      args: ["server.js"],
      env: { MCP_TEST: "true" },
      cwd: "/workspace",
      stderr: "pipe",
      maxBufferSize: 1024,
    });
  });

  it("requires the latest modern MCP protocol", async () => {
    const client = new McpClient({
      name: "modern",
      transport: { type: "stdio", command: "node", args: ["server.js"] },
    });

    await client.connect();

    expect(sdk.clients[0]?.options).toEqual({
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    });
  });

  it("creates protected Streamable HTTP without exposing custom fetch", async () => {
    const client = new McpClient({
      name: "github",
      transport: {
        type: "streamableHttp",
        url: "https://api.example.com/mcp",
        headers: { authorization: "Bearer test" },
        reconnectionOptions: {
          maxReconnectionDelay: 30_000,
          initialReconnectionDelay: 1_000,
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 2,
        },
        sessionId: "session-1",
      },
    });

    await client.connect();

    expect(sdk.httpTransports[0]?.url.href).toBe("https://api.example.com/mcp");
    expect(sdk.httpTransports[0]?.options).toMatchObject({
      reconnectionOptions: {
        maxReconnectionDelay: 30_000,
        initialReconnectionDelay: 1_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 2,
      },
      sessionId: "session-1",
      fetch: expect.any(Function),
    });
    expect(sdk.httpTransports[0]?.options).not.toHaveProperty("requestInit");
  });

  it("scopes configured headers to the exact MCP endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    const client = new McpClient({
      name: "local",
      transport: {
        type: "streamableHttp",
        url: "http://localhost:3000/mcp",
        ssrfProtection: "disabled",
        headers: { "x-api-key": "secret" },
      },
    });

    await client.connect();
    const fetchRequest = sdk.httpTransports[0]?.options.fetch as typeof fetch;
    await fetchRequest("http://localhost:3000/mcp", { headers: { "x-request": "mcp" } });
    await fetchRequest("https://auth.example.com/.well-known/oauth-authorization-server");

    const endpointInit = fetchMock.mock.calls[0]?.[1];
    expect(Object.fromEntries(new Headers(endpointInit?.headers))).toEqual({
      "x-api-key": "secret",
      "x-request": "mcp",
    });
    expect(endpointInit?.redirect).toBe("error");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toBeUndefined();
    fetchMock.mockRestore();
  });

  it("rejects non-string Streamable HTTP headers without coercion", async () => {
    const client = new McpClient({
      name: "invalid-headers",
      transport: {
        type: "streamableHttp",
        url: "https://api.example.com/mcp",
        headers: { authorization: 123 },
      } as never,
    });

    await expect(client.connect()).rejects.toThrow(
      "MCP Streamable HTTP header authorization must be a string",
    );
  });

  it("rejects non-record Streamable HTTP header containers", async () => {
    const client = new McpClient({
      name: "invalid-header-container",
      transport: {
        type: "streamableHttp",
        url: "https://api.example.com/mcp",
        headers: new Headers({ authorization: "Bearer test" }),
      } as never,
    });

    await expect(client.connect()).rejects.toThrow(
      "MCP Streamable HTTP headers must be a plain object",
    );
  });

  it.each([
    "accept",
    "Content-Type",
    "last-event-id",
    "Mcp-Method",
    "mcp-name",
    "Mcp-Param-region",
    "MCP-Protocol-Version",
    "mcp-session-id",
  ])("rejects transport-owned Streamable HTTP header %s", async (header) => {
    const client = new McpClient({
      name: "reserved-header",
      transport: {
        type: "streamableHttp",
        url: "https://api.example.com/mcp",
        headers: { [header]: "override" },
      },
    });

    await expect(client.connect()).rejects.toThrow(
      `MCP Streamable HTTP header ${header} is owned by the transport`,
    );
  });

  it("rejects a static authorization header combined with OAuth", async () => {
    const client = new McpClient({
      name: "conflicting-auth",
      transport: {
        type: "streamableHttp",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer static" },
        authProvider: {} as never,
      },
    });

    await expect(client.connect()).rejects.toThrow(
      "MCP Streamable HTTP authorization header cannot be combined with authProvider",
    );
  });

  it("allows an explicit SSRF protection opt-out for local Streamable HTTP", async () => {
    const client = new McpClient({
      name: "local",
      transport: {
        type: "streamableHttp",
        url: "http://localhost:3000/mcp",
        ssrfProtection: "disabled",
      },
    });

    await client.connect();

    expect(sdk.httpTransports[0]?.url.href).toBe("http://localhost:3000/mcp");
    expect(sdk.httpTransports[0]?.options).not.toHaveProperty("fetch");
  });

  it("rejects an unknown Streamable HTTP SSRF policy at runtime", async () => {
    const client = new McpClient({
      name: "invalid",
      transport: {
        type: "streamableHttp",
        url: "https://api.example.com/mcp",
        ssrfProtection: "unknown",
      } as never,
    });

    await expect(client.connect()).rejects.toThrow(
      "MCP Streamable HTTP ssrfProtection must be strict or disabled",
    );
  });

  it("still rejects non-HTTP URLs when SSRF protection is disabled", async () => {
    const client = new McpClient({
      name: "invalid-protocol",
      transport: {
        type: "streamableHttp",
        url: "file:///tmp/mcp.sock",
        ssrfProtection: "disabled",
      },
    });

    await expect(client.connect()).rejects.toThrow("only HTTP(S) URLs are allowed");
  });

  it("uses explicit caller-owned custom transports", async () => {
    const transport = { start: vi.fn(), send: vi.fn(), close: vi.fn() };
    const create = vi.fn((_options: { abortSignal?: AbortSignal | undefined }) => transport);
    const abortController = new AbortController();
    const client = new McpClient({
      name: "custom",
      transport: { type: "custom", create },
    });

    await client.connect({ abortSignal: abortController.signal });

    const createSignal = create.mock.calls[0]?.[0].abortSignal;
    const connectSignal = (
      sdk.clients[0]?.connectCalls[0]?.options as { signal?: AbortSignal } | undefined
    )?.signal;
    expect(createSignal).toBeInstanceOf(AbortSignal);
    expect(connectSignal).toBe(createSignal);
    expect(createSignal).not.toBe(abortController.signal);
  });

  it("discovers every page, captures metadata, prefixes exposed names, and freezes snapshots", async () => {
    sdk.behaviors.push({
      pages: [
        { tools: [toolDefinition("read")], nextCursor: "next" },
        { tools: [toolDefinition("write")] },
      ],
      serverInfo: { name: "remote", version: "1.2.3" },
      capabilities: { tools: { listChanged: true } },
      instructions: "Remote metadata",
      result: { content: [{ type: "text", text: "done" }] },
    });
    const client = new McpClient({
      name: "files",
      transport: { type: "custom", create: () => fakeTransport() },
      tools: { prefix: "files_" },
    });

    const server = await client.connect();
    const signal = new AbortController().signal;
    await expect(server.tools[0]?.call({}, { abortSignal: signal })).resolves.toEqual(
      ToolOutput.content([{ type: "text", text: "done" }]),
    );

    expect(server).toMatchObject({
      name: "files",
      serverInfo: { name: "remote", version: "1.2.3" },
      capabilities: { tools: { listChanged: true } },
      instructions: "Remote metadata",
    });
    expect(server.tools.map((tool) => tool.name)).toEqual(["files_read", "files_write"]);
    expect(server.tools[0]?.mcp).toEqual({ serverName: "files", remoteName: "read" });
    const discoverySignal = (
      sdk.clients[0]?.connectCalls[0]?.options as { signal?: AbortSignal } | undefined
    )?.signal;
    expect(sdk.clients[0]?.listToolsCalls).toEqual([
      { params: undefined, options: { signal: discoverySignal } },
    ]);
    expect(sdk.clients[0]?.callToolCalls[0]).toEqual({
      params: { name: "read", arguments: {} },
      options: { signal },
    });
    expect(Object.isFrozen(server)).toBe(true);
    expect(Object.isFrozen(server.tools)).toBe(true);
    expect(Object.isFrozen(server.serverInfo)).toBe(true);
    expect(Object.isFrozen(server.capabilities)).toBe(true);
    const definition = await server.tools[0]?.definition("");
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition?.parameters)).toBe(true);
  });

  it("memoizes concurrent connection and permits retry after failed initialization", async () => {
    const release = deferred<void>();
    sdk.behaviors.push({ connect: () => release.promise });
    const client = stdioClient("shared");
    const first = client.connect();
    const second = client.connect();
    expect(first).toBe(second);
    expect(sdk.clients).toHaveLength(1);
    release.resolve();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    sdk.behaviors.push({ connectError: new Error("connect failed") }, {});
    const retrying = stdioClient("retrying");
    await expect(retrying.connect()).rejects.toThrow("connect failed");
    expect(sdk.clients[1]?.closeCalls).toBe(1);
    await expect(retrying.connect()).resolves.toMatchObject({ name: "retrying" });
    expect(sdk.clients).toHaveLength(3);
  });

  it("cleans up discovery failures and permits a later retry", async () => {
    sdk.behaviors.push({ listError: new Error("discovery failed") }, {});
    const client = stdioClient("discovery");

    await expect(client.connect()).rejects.toThrow("discovery failed");
    expect(sdk.clients[0]?.closeCalls).toBe(1);
    await expect(client.connect()).resolves.toMatchObject({ name: "discovery" });
    expect(sdk.clients).toHaveLength(2);
  });

  it("closes idempotently and rejects connection after terminal close", async () => {
    const client = stdioClient("terminal");
    await client.connect();

    await Promise.all([client.close(), client.close()]);

    expect(sdk.clients[0]?.closeCalls).toBe(1);
    await expect(client.connect()).rejects.toThrow('MCP client "terminal" is closed');
  });

  it("actively aborts and closes an in-flight connection without waiting for it", async () => {
    const release = deferred<void>();
    sdk.behaviors.push({ connect: () => release.promise });
    const client = stdioClient("in-flight");
    const connecting = client.connect();
    await vi.waitFor(() => expect(sdk.clients[0]?.connectCalls).toHaveLength(1));

    await client.close();

    expect(sdk.clients[0]?.closeCalls).toBe(1);
    const signal = (sdk.clients[0]?.connectCalls[0]?.options as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(true);
    release.resolve();
    const error = await connecting.catch((connectionError: unknown) => connectionError);
    expect(error).toMatchObject({ name: "AbortError" });
    expect((error as Error).cause).toMatchObject({
      message: 'MCP client "in-flight" was closed during connection',
    });
  });

  it("can close before connecting without creating transport resources", async () => {
    const client = stdioClient("unused");

    await client.close();

    expect(sdk.clients).toHaveLength(0);
    await expect(client.connect()).rejects.toThrow('MCP client "unused" is closed');
  });

  it("maps portable content and rejects unsupported MCP content explicitly", async () => {
    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("rich")] }],
      result: {
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "abc", mimeType: "image/png" },
          {
            type: "resource",
            resource: { uri: "file:///note.txt", mimeType: "text/plain", text: "note" },
          },
          {
            type: "resource",
            resource: { uri: "file:///blob.bin", blob: "YWJj" },
          },
        ],
      },
    });
    const rich = await stdioClient("rich").connect();
    await expect(rich.tools[0]?.call({})).resolves.toEqual(
      ToolOutput.content([
        { type: "text", text: "hello" },
        { type: "file", data: { type: "data", data: "abc" }, mediaType: "image/png" },
        {
          type: "text",
          text: "MCP resource (file:///note.txt; text/plain; text)\nnote",
        },
        {
          type: "text",
          text: "MCP resource (file:///blob.bin; application/octet-stream; base64)\nYWJj",
        },
      ]),
    );

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("audio")] }],
      result: { content: [{ type: "audio", data: "abc", mimeType: "audio/wav" }] },
    });
    const audio = await stdioClient("audio").connect();
    await expect(audio.tools[0]?.call({})).rejects.toThrow(
      "Unsupported MCP tool result content type: audio",
    );

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("link")] }],
      result: { content: [{ type: "resource_link", uri: "file:///x", name: "x" }] },
    });
    const link = await stdioClient("link").connect();
    await expect(link.tools[0]?.call({})).rejects.toThrow(
      "Unsupported MCP tool result content type: resource_link",
    );
  });

  it("serializes direct and structured results and surfaces MCP errors", async () => {
    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("direct")] }],
      result: { toolResult: { ok: true } },
    });
    const direct = await stdioClient("direct").connect();
    await expect(direct.tools[0]?.call({})).resolves.toEqual(
      ToolOutput.content([{ type: "text", text: '{"ok":true}' }]),
    );

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("structured")] }],
      result: { content: [], structuredContent: { count: 2 } },
    });
    const structured = await stdioClient("structured").connect();
    await expect(structured.tools[0]?.call({})).resolves.toEqual(
      ToolOutput.content([{ type: "text", text: '{"count":2}' }]),
    );

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("invalid-direct")] }],
      result: { toolResult: undefined },
    });
    const invalidDirect = await stdioClient("invalid-direct").connect();
    await expect(invalidDirect.tools[0]?.call({})).rejects.toThrow(
      "MCP tool results must be strict JSON values",
    );

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("invalid-direct-json")] }],
      result: { toolResult: { amount: Number.NaN } },
    });
    const invalidDirectJson = await stdioClient("invalid-direct-json").connect();
    await expect(invalidDirectJson.tools[0]?.call({})).rejects.toThrow(
      "MCP tool results must be strict JSON values",
    );

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("invalid-structured-json")] }],
      result: { content: [], structuredContent: { missing: undefined } },
    });
    const invalidStructuredJson = await stdioClient("invalid-structured-json").connect();
    await expect(invalidStructuredJson.tools[0]?.call({})).rejects.toThrow(
      "MCP tool results must be strict JSON values",
    );

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("error")] }],
      result: { content: [{ type: "text", text: "remote failed" }], isError: true },
    });
    const error = await stdioClient("error").connect();
    await expect(error.tools[0]?.call({})).rejects.toThrow("remote failed");
  });

  it("rejects duplicate exposed tool names", async () => {
    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("same"), toolDefinition("same")] }],
    });
    await expect(stdioClient("duplicates").connect()).rejects.toThrow(
      'Duplicate MCP tool name "same"',
    );
  });

  it("requires MCP tool arguments to be JSON objects", async () => {
    sdk.behaviors.push({ pages: [{ tools: [toolDefinition("args")] }] });
    const server = await stdioClient("args").connect();

    await expect(server.tools[0]?.call(undefined)).resolves.toEqual(
      ToolOutput.content([{ type: "text", text: "ok" }]),
    );
    expect(sdk.clients[0]?.callToolCalls[0]?.params).toEqual({ name: "args" });
    expect(() => server.tools[0]?.parseInput?.(null)).toThrow(
      "MCP tool arguments must be a strict JSON object",
    );
    for (const input of [null, "invalid", [], new Date(), { value: undefined }]) {
      await expect(server.tools[0]?.call(input)).rejects.toThrow(
        "MCP tool arguments must be a strict JSON object",
      );
    }
  });
});

describe("McpClientGroup", () => {
  beforeEach(() => {
    sdk.behaviors.length = 0;
    sdk.clients.length = 0;
    sdk.stdioTransports.length = 0;
    sdk.httpTransports.length = 0;
  });

  it("connects concurrently and preserves immutable client order", async () => {
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    sdk.behaviors.push(
      { connect: () => firstGate.promise, pages: [{ tools: [toolDefinition("first")] }] },
      { connect: () => secondGate.promise, pages: [{ tools: [toolDefinition("second")] }] },
    );
    const clients = [stdioClient("one"), stdioClient("two")];
    const connecting = McpClientGroup.connect({ clients });
    await vi.waitFor(() => expect(sdk.clients).toHaveLength(2));
    firstGate.resolve();
    secondGate.resolve();

    const group = await connecting;
    expect(group.clients).toEqual(clients);
    expect(group.servers.map((server) => server.name)).toEqual(["one", "two"]);
    expect(Object.isFrozen(group.clients)).toBe(true);
    expect(Object.isFrozen(group.servers)).toBe(true);
  });

  it("propagates group cancellation to every client connection", async () => {
    const release = deferred<void>();
    sdk.behaviors.push({ connect: () => release.promise }, { connect: () => release.promise });
    const abortController = new AbortController();
    const connecting = McpClientGroup.connect({
      clients: [stdioClient("one"), stdioClient("two")],
      abortSignal: abortController.signal,
    });
    await vi.waitFor(() => expect(sdk.clients).toHaveLength(2));

    abortController.abort(new Error("cancel group"));
    const signals = sdk.clients.map(
      (client) => (client.connectCalls[0]?.options as { signal?: AbortSignal }).signal,
    );
    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
    release.resolve();
    await expect(connecting).rejects.toMatchObject({
      name: "AbortError",
      cause: expect.objectContaining({ message: "cancel group" }),
    });
  });

  it("cancels sibling connections immediately when one client fails", async () => {
    const siblingStarted = deferred<void>();
    sdk.behaviors.push(
      { connectError: new Error("first failed") },
      {
        connect: (options) => {
          const signal = (options as { signal: AbortSignal }).signal;
          siblingStarted.resolve();
          return new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
    );

    const connecting = McpClientGroup.connect({
      clients: [stdioClient("one"), stdioClient("two")],
    });
    await siblingStarted.promise;

    await expect(connecting).rejects.toThrow("first failed");
    const siblingSignal = (
      sdk.clients[1]?.connectCalls[0]?.options as { signal?: AbortSignal } | undefined
    )?.signal;
    expect(siblingSignal?.aborted).toBe(true);
    expect(sdk.clients.map((client) => client.closeCalls)).toEqual([1, 1]);
  });

  it("rejects duplicate clients before I/O and duplicate tools transactionally", async () => {
    const duplicate = stdioClient("same");
    await expect(McpClientGroup.connect({ clients: [duplicate, duplicate] })).rejects.toThrow(
      'Duplicate MCP client name "same"',
    );
    expect(sdk.clients).toHaveLength(0);

    sdk.behaviors.push(
      { pages: [{ tools: [toolDefinition("shared")] }] },
      { pages: [{ tools: [toolDefinition("shared")] }] },
    );
    await expect(
      McpClientGroup.connect({ clients: [stdioClient("one"), stdioClient("two")] }),
    ).rejects.toThrow('Duplicate MCP tool name "shared"');
    expect(sdk.clients.map((client) => client.closeCalls)).toEqual([1, 1]);
  });

  it("rolls back successful connections when another client fails", async () => {
    sdk.behaviors.push({}, { connectError: new Error("second failed") });

    await expect(
      McpClientGroup.connect({ clients: [stdioClient("one"), stdioClient("two")] }),
    ).rejects.toThrow("second failed");

    expect(sdk.clients.map((client) => client.closeCalls)).toEqual([1, 1]);
  });

  it("attempts every close and reports combined shutdown failures", async () => {
    sdk.behaviors.push(
      { closeError: new Error("one close failed") },
      { closeError: new Error("two close failed") },
    );
    const group = await McpClientGroup.connect({
      clients: [stdioClient("one"), stdioClient("two")],
    });

    await expect(group.close()).rejects.toMatchObject({
      name: "AggregateError",
      errors: [expect.any(Error), expect.any(Error)],
    });
    expect(sdk.clients.map((client) => client.closeCalls)).toEqual([1, 1]);
    await expect(group.close()).rejects.toBeInstanceOf(AggregateError);
    expect(sdk.clients.map((client) => client.closeCalls)).toEqual([1, 1]);
  });
});

function stdioClient(name: string): McpClient {
  return new McpClient({
    name,
    transport: { type: "stdio", command: "node", args: ["server.js"] },
  });
}

function toolDefinition(name: string): ToolDefinition {
  return { name, description: `${name} tool`, inputSchema: { type: "object" } };
}

function fakeTransport() {
  return {
    async start() {},
    async send() {},
    async close() {},
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
