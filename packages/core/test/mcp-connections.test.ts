import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcp } from "../src/mcp";

const sdk = vi.hoisted(() => {
  type ClientRecord = {
    metadata: unknown;
    connectCalls: unknown[];
  };

  type SseTransportRecord = {
    url: URL;
    options: unknown;
  };

  const clients: ClientRecord[] = [];
  const sseTransports: SseTransportRecord[] = [];

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

  return { Client, SSEClientTransport, clients, sseTransports };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: sdk.Client,
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: sdk.SSEClientTransport,
}));

describe("MCP connection factories", () => {
  beforeEach(() => {
    sdk.clients.length = 0;
    sdk.sseTransports.length = 0;
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
      version: "0.1.0",
    });
    expect(sdk.sseTransports).toHaveLength(1);
    expect(sdk.sseTransports[0]).toBeInstanceOf(sdk.SSEClientTransport);
    expect(sdk.sseTransports[0]?.url.href).toBe("http://localhost:3000/sse");
    expect(sdk.sseTransports[0]?.options).toBe(transportOptions);
    expect(sdk.clients[0]?.connectCalls).toEqual([sdk.sseTransports[0]]);
  });
});
