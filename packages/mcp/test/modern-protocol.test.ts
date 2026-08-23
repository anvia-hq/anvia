import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { McpClient } from "../src";

class ProtocolTransport implements Transport {
  readonly messages: JSONRPCMessage[] = [];
  readonly #modern: boolean;

  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"];

  constructor(modern: boolean) {
    this.#modern = modern;
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.messages.push(message);
    if (!("id" in message) || !("method" in message)) return;

    if (message.method === "server/discover") {
      const response: JSONRPCMessage = this.#modern
        ? {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              supportedVersions: ["2026-07-28"],
              capabilities: { tools: {} },
            },
          }
        : {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" },
          };
      queueMicrotask(() => this.onmessage?.(response));
      return;
    }

    if (message.method === "tools/list") {
      const response: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          resultType: "complete",
          ttlMs: 0,
          cacheScope: "public",
          tools: [],
        },
      };
      queueMicrotask(() => this.onmessage?.(response));
    }
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

describe("modern MCP protocol", () => {
  it("pins 2026-07-28 and connects without a legacy initialize handshake", async () => {
    const transport = new ProtocolTransport(true);
    const client = customClient(transport);

    await expect(client.connect()).resolves.toMatchObject({ name: "modern" });

    expect(requestMethods(transport)).toEqual(["server/discover", "tools/list"]);
    expect(transport.messages[0]).toMatchObject({
      params: {
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
      },
    });
    await client.close();
  });

  it("rejects a legacy server without falling back to initialize", async () => {
    const transport = new ProtocolTransport(false);
    const client = customClient(transport);

    await expect(client.connect()).rejects.toThrow();

    expect(requestMethods(transport)).toEqual(["server/discover"]);
  });
});

function customClient(transport: Transport): McpClient {
  return new McpClient({
    name: "modern",
    transport: { type: "custom", create: () => transport },
  });
}

function requestMethods(transport: ProtocolTransport): string[] {
  return transport.messages.flatMap((message) =>
    "method" in message && typeof message.method === "string" ? [message.method] : [],
  );
}
