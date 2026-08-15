import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpClient, McpClientGroup } from "../src/mcp";

const corePackageVersion = JSON.parse(
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
    readonly behavior: Behavior;
    readonly connectCalls: Array<{ transport: unknown; options: unknown }> = [];
    readonly listToolsCalls: Array<{ params: unknown; options: unknown }> = [];
    readonly callToolCalls: Array<{ params: unknown; options: unknown }> = [];
    closeCalls = 0;
    page = 0;

    constructor(metadata: unknown) {
      this.metadata = metadata;
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
      return this.behavior.pages?.[this.page++] ?? { tools: [] };
    }

    async callTool(params: unknown, _schema: unknown, options: unknown) {
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

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: sdk.SdkClient }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: sdk.StdioClientTransport,
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: sdk.StreamableHTTPClientTransport,
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
      name: "@anvia/core",
      version: corePackageVersion.version,
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

  it("creates protected Streamable HTTP without exposing custom fetch", async () => {
    const client = new McpClient({
      name: "github",
      transport: {
        type: "streamableHttp",
        url: "https://api.example.com/mcp",
        requestInit: { headers: { authorization: "Bearer test" } },
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
      requestInit: { headers: { authorization: "Bearer test" } },
      reconnectionOptions: {
        maxReconnectionDelay: 30_000,
        initialReconnectionDelay: 1_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 2,
      },
      sessionId: "session-1",
      fetch: expect.any(Function),
    });
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
    await expect(server.tools[0]?.call({}, { abortSignal: signal })).resolves.toEqual([
      { type: "text", text: "done" },
    ]);

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
      { params: { cursor: "next" }, options: { signal: discoverySignal } },
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
    await expect(rich.tools[0]?.call({})).resolves.toEqual([
      { type: "text", text: "hello" },
      { type: "image", data: "abc", mediaType: "image/png" },
      {
        type: "text",
        text: "MCP resource (file:///note.txt; text/plain; text)\nnote",
      },
      {
        type: "text",
        text: "MCP resource (file:///blob.bin; application/octet-stream; base64)\nYWJj",
      },
    ]);

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
    await expect(direct.tools[0]?.call({})).resolves.toEqual([
      { type: "text", text: '{"ok":true}' },
    ]);

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("structured")] }],
      result: { content: [], structuredContent: { count: 2 } },
    });
    const structured = await stdioClient("structured").connect();
    await expect(structured.tools[0]?.call({})).resolves.toEqual([
      { type: "text", text: '{"count":2}' },
    ]);

    sdk.behaviors.push({
      pages: [{ tools: [toolDefinition("error")] }],
      result: { content: [{ type: "text", text: "remote failed" }], isError: true },
    });
    const error = await stdioClient("error").connect();
    await expect(error.tools[0]?.call({})).rejects.toThrow("remote failed");
  });

  it("rejects repeated pagination cursors and duplicate exposed tool names", async () => {
    sdk.behaviors.push({
      pages: [
        { tools: [], nextCursor: "loop" },
        { tools: [], nextCursor: "loop" },
      ],
    });
    await expect(stdioClient("loop").connect()).rejects.toThrow("repeated tools cursor");

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

    await expect(server.tools[0]?.call(null)).resolves.toEqual([{ type: "text", text: "ok" }]);
    expect(sdk.clients[0]?.callToolCalls[0]?.params).toEqual({ name: "args" });
    await expect(server.tools[0]?.call("invalid")).rejects.toThrow(
      "MCP tool arguments must be a JSON object",
    );
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
