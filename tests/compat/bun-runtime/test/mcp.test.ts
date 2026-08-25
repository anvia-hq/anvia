import { afterAll, describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { normalizeToolResultOutput } from "@anvia/core/tool";
import { McpClient } from "@anvia/mcp";

type RpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown> | undefined;
};

type RecordedRequest = {
  method: string;
  headers: Headers;
  params?: Record<string, unknown> | undefined;
};

const requests: RecordedRequest[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const message = (await request.json()) as RpcRequest;
    requests.push({
      method: message.method,
      headers: new Headers(request.headers),
      params: message.params,
    });
    const response = {
      jsonrpc: "2.0" as const,
      id: message.id,
      result: resultFor(message),
    };

    return message.method === "tools/call" ? eventStream(response) : Response.json(response);
  },
});

afterAll(() => {
  server.stop(true);
});

describe("@anvia/mcp under Bun", () => {
  it("negotiates and calls a Streamable HTTP tool through a chunked SSE response", async () => {
    requests.length = 0;
    const client = new McpClient({
      name: "bun-http",
      transport: {
        type: "streamableHttp",
        url: new URL("/mcp", server.url),
        ssrfProtection: "disabled",
        headers: { "x-api-key": "bun-test-secret" },
      },
      tools: { prefix: "bun_" },
    });

    try {
      const registration = await client.connect();
      expect(registration).toMatchObject({
        name: "bun-http",
        serverInfo: { name: "bun-http-fixture", version: "1.0.0" },
        instructions: "Served by Bun.",
      });
      expect(registration.tools).toHaveLength(1);
      const tool = registration.tools[0];
      if (tool === undefined) throw new Error("Expected the Bun MCP fixture tool");
      expect(tool.name).toBe("bun_echo");

      const output = normalizeToolResultOutput(await tool.call({ text: "hello from Bun" }));
      expect(output).toEqual({
        type: "content",
        value: [{ type: "text", text: "echo:hello from Bun" }],
      });

      expect(requests.map((request) => request.method)).toEqual([
        "server/discover",
        "tools/list",
        "tools/call",
      ]);
      expect(
        requests.every((request) => request.headers.get("x-api-key") === "bun-test-secret"),
      ).toBe(true);
      expect(requests.map((request) => request.headers.get("mcp-method"))).toEqual([
        "server/discover",
        "tools/list",
        "tools/call",
      ]);
      expect(requests[2]?.headers.get("mcp-name")).toBe("echo");
      expect(requests[2]?.params).toMatchObject({
        name: "echo",
        arguments: { text: "hello from Bun" },
      });
    } finally {
      await client.close();
    }
  });

  it("spawns and communicates with an MCP stdio subprocess", async () => {
    const fixturePath = fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url));
    const client = new McpClient({
      name: "bun-stdio",
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [fixturePath],
      },
    });

    try {
      const registration = await client.connect();
      expect(registration).toMatchObject({
        name: "bun-stdio",
        serverInfo: { name: "bun-stdio-fixture", version: "1.0.0" },
      });
      const tool = registration.tools[0];
      if (tool === undefined) throw new Error("Expected the Bun stdio fixture tool");

      await expect(
        Promise.resolve(tool.call({ text: "subprocess" })).then(normalizeToolResultOutput),
      ).resolves.toEqual({
        type: "content",
        value: [{ type: "text", text: "echo:subprocess" }],
      });
    } finally {
      await client.close();
    }
  });

  it("blocks a loopback Streamable HTTP endpoint before Bun fetch runs", async () => {
    requests.length = 0;
    const client = new McpClient({
      name: "blocked-local",
      transport: {
        type: "streamableHttp",
        url: new URL("/mcp", server.url),
      },
    });

    await expect(client.connect()).rejects.toThrow("localhost not allowed");
    expect(requests).toHaveLength(0);
    await client.close();
  });
});

function resultFor(message: RpcRequest): Record<string, unknown> {
  if (message.method === "server/discover") {
    return {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
      instructions: "Served by Bun.",
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "bun-http-fixture",
          version: "1.0.0",
        },
      },
    };
  }
  if (message.method === "tools/list") {
    return {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "public",
      tools: [
        {
          name: "echo",
          description: "Echo text from the Bun fixture.",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      ],
    };
  }
  if (message.method === "tools/call") {
    const text = message.params?.arguments;
    const value =
      typeof text === "object" && text !== null && "text" in text
        ? String((text as { text: unknown }).text)
        : "";
    return {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "private",
      content: [{ type: "text", text: `echo:${value}` }],
    };
  }
  return {};
}

function eventStream(message: unknown): Response {
  const encoded = new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  const splitAt = Math.floor(encoded.byteLength / 2);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        queueMicrotask(() => {
          controller.enqueue(encoded.slice(splitAt));
          controller.close();
        });
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
