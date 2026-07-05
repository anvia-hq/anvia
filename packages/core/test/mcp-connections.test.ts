import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcp } from "../src/mcp";

const corePackageVersion = readCorePackageVersion();

function readCorePackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new TypeError("Expected @anvia/core package.json to contain a version string.");
  }
  return packageJson.version;
}

const sdk = vi.hoisted(() => {
  type ClientRecord = {
    metadata: unknown;
    connectCalls: unknown[];
  };

  type SseTransportRecord = {
    url: URL;
    options: unknown;
  };

  type HttpTransportRecord = {
    url: URL;
    options: unknown;
  };

  type StdioTransportRecord = {
    server: unknown;
  };

  const clients: ClientRecord[] = [];
  const sseTransports: SseTransportRecord[] = [];
  const httpTransports: HttpTransportRecord[] = [];
  const stdioTransports: StdioTransportRecord[] = [];

  class Client {
    readonly metadata: unknown;
    readonly connectCalls: unknown[] = [];

    constructor(metadata: unknown) {
      this.metadata = metadata;
      clients.push(this);
    }

    async connect(transport: unknown): Promise<void> {
      this.connectCalls.push(transport);
    }
  }

  class SSEClientTransport {
    readonly url: URL;
    readonly options: unknown;

    constructor(url: URL, options: unknown) {
      this.url = url;
      this.options = options;
      sseTransports.push(this);
    }
  }

  class StreamableHTTPClientTransport {
    readonly url: URL;
    readonly options: unknown;

    constructor(url: URL, options: unknown) {
      this.url = url;
      this.options = options;
      httpTransports.push(this);
    }
  }

  class StdioClientTransport {
    readonly server: unknown;

    constructor(server: unknown) {
      this.server = server;
      stdioTransports.push(this);
    }
  }

  return {
    Client,
    SSEClientTransport,
    StdioClientTransport,
    StreamableHTTPClientTransport,
    clients,
    httpTransports,
    sseTransports,
    stdioTransports,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: sdk.Client,
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: sdk.SSEClientTransport,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: sdk.StdioClientTransport,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: sdk.StreamableHTTPClientTransport,
}));

describe("MCP connection factories", () => {
  beforeEach(() => {
    sdk.clients.length = 0;
    sdk.httpTransports.length = 0;
    sdk.sseTransports.length = 0;
    sdk.stdioTransports.length = 0;
  });

  it("creates stdio connections with the SDK stdio transport", async () => {
    const connection = mcp.stdio({
      name: "local-server",
      command: "node",
      args: ["server.js"],
      env: { API_KEY: "test-key" },
    });

    expect(connection.name).toBe("local-server");

    const client = await connection.connect();

    expect(sdk.clients).toHaveLength(1);
    expect(client).toBe(sdk.clients[0]);
    expect(sdk.clients[0]?.metadata).toEqual({
      name: "@anvia/core",
      version: corePackageVersion,
    });
    expect(sdk.stdioTransports).toHaveLength(1);
    expect(sdk.stdioTransports[0]).toBeInstanceOf(sdk.StdioClientTransport);
    expect(sdk.stdioTransports[0]?.server).toEqual({
      command: "node",
      args: ["server.js"],
      env: { API_KEY: "test-key" },
    });
    expect(sdk.clients[0]?.connectCalls).toEqual([sdk.stdioTransports[0]]);
  });

  it("creates streamable HTTP connections with the SDK HTTP transport", async () => {
    const transportOptions = {
      requestInit: {
        headers: {
          authorization: "Bearer test",
        },
      },
    };

    const connection = mcp.http({
      name: "http-server",
      url: "http://localhost:3000/mcp",
      transport: transportOptions,
    });

    expect(connection.name).toBe("http-server");

    const client = await connection.connect();

    expect(sdk.clients).toHaveLength(1);
    expect(client).toBe(sdk.clients[0]);
    expect(sdk.clients[0]?.metadata).toEqual({
      name: "@anvia/core",
      version: corePackageVersion,
    });
    expect(sdk.httpTransports).toHaveLength(1);
    expect(sdk.httpTransports[0]).toBeInstanceOf(sdk.StreamableHTTPClientTransport);
    expect(sdk.httpTransports[0]?.url.href).toBe("http://localhost:3000/mcp");
    expect(sdk.httpTransports[0]?.options).toBe(transportOptions);
    expect(sdk.clients[0]?.connectCalls).toEqual([sdk.httpTransports[0]]);
  });

  it("creates legacy SSE connections with the SDK SSE transport", async () => {
    const transportOptions = {
      requestInit: {
        headers: {
          "x-api-key": "test-key",
        },
      },
    };

    const connection = mcp.sse({
      name: "legacy-server",
      url: "http://localhost:3000/sse",
      transport: transportOptions,
    });

    expect(connection.name).toBe("legacy-server");

    const client = await connection.connect();

    expect(sdk.clients).toHaveLength(1);
    expect(client).toBe(sdk.clients[0]);
    expect(sdk.clients[0]?.metadata).toEqual({
      name: "@anvia/core",
      version: corePackageVersion,
    });
    expect(sdk.sseTransports).toHaveLength(1);
    expect(sdk.sseTransports[0]).toBeInstanceOf(sdk.SSEClientTransport);
    expect(sdk.sseTransports[0]?.url.href).toBe("http://localhost:3000/sse");
    expect(sdk.sseTransports[0]?.options).toBe(transportOptions);
    expect(sdk.clients[0]?.connectCalls).toEqual([sdk.sseTransports[0]]);
  });
});
