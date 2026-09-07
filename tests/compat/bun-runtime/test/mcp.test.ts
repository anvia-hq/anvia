import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("passes stdio environment variables through to the MCP subprocess", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/mcp-stdio-env-server.mjs", import.meta.url),
    );
    const client = new McpClient({
      name: "bun-stdio-env",
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [fixturePath],
        env: { FIXTURE_TOKEN: "bun-env-ok" },
      },
    });

    try {
      const registration = await client.connect();
      expect(registration.instructions).toBe("token:bun-env-ok");
    } finally {
      await client.close();
    }
  });

  it("closes cleanly while a stdio tool call is in flight", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/mcp-stdio-slow-server.mjs", import.meta.url),
    );
    const workDir = mkdtempSync(join(tmpdir(), "anvia-mcp-slow-"));
    const receiptPath = join(workDir, "receipt.json");
    const exitMarkerPath = join(workDir, "exited");
    const client = new McpClient({
      name: "bun-stdio-slow",
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [fixturePath],
        env: { MCP_SLOW_RECEIPT: receiptPath, MCP_SLOW_EXIT: exitMarkerPath },
      },
    });

    try {
      const registration = await client.connect();
      const tool = registration.tools[0];
      if (tool === undefined) throw new Error("Expected the slow MCP fixture tool");

      const pending = Promise.resolve(tool.call({ text: "slow" }));

      // The receipt proves the fixture received the call and is parked in its
      // delayed reply, so close() below really races an in-flight request.
      await waitForReceipt(receiptPath);
      const { pid } = JSON.parse(readFileSync(receiptPath, "utf8")) as { pid: number };

      // Either close outcome is SDK-defined while a call is in flight; the
      // contract is that close settles instead of hanging.
      const closed = within(
        client.close().then(
          () => "resolved" as const,
          () => "rejected" as const,
        ),
      );
      await expect(
        within(
          pending.then(
            () => "settled",
            () => "settled",
          ),
        ),
      ).resolves.toBe("settled");
      expect(["resolved", "rejected"]).toContain(await closed);

      // The child must not outlive the client: closing the transport has to
      // terminate the fixture (SIGTERM marker or dead pid), never leak it
      // until the fixture's own 10s reply timer fires.
      const exitEvidence = await waitForExit(pid, exitMarkerPath);
      expect(["signaled", "dead"]).toContain(exitEvidence);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 12_000);
});

// Watchdog, not a delay: the awaited signal is the close/settle event itself.
// The timer only bounds a leaked-subprocess hang that has no deterministic signal.
async function within<T>(promise: Promise<T>, timeoutMs = 3_000): Promise<T> {
  let timeout: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for close")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

// Polls for the fixture's receipt file: proof the subprocess received the tool
// call. The awaited signal is the file; the deadline only bounds a broken fixture.
async function waitForReceipt(path: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await Bun.sleep(10);
  }
  throw new Error("Fixture never acknowledged the tool call");
}

// Waits for fixture termination after close(): either the SIGTERM marker it
// writes on signal receipt or a dead pid. The deadline bounds a leaked child.
async function waitForExit(
  pid: number,
  exitMarkerPath: string,
  timeoutMs = 8_000,
): Promise<"signaled" | "dead"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(exitMarkerPath)) return "signaled";
    try {
      process.kill(pid, 0);
    } catch {
      return "dead";
    }
    await Bun.sleep(20);
  }
  throw new Error(`Fixture subprocess (pid ${pid}) outlived client close`);
}

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
