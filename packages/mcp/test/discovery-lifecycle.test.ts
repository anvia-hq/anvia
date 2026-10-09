import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { McpClient, type McpClientOptions } from "../src";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
) {
  const server = createServer((request, response) => {
    void handler(request, response).catch((error) => {
      response.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}
async function body(request: IncomingMessage) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text) as { id?: number; method: string; params?: { cursor?: string } };
}
function json(response: ServerResponse, id: number | undefined, result: unknown, headers = {}) {
  response.writeHead(200, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}
function client(
  url: string,
  options: {
    terminate?: boolean;
    limits?: NonNullable<McpClientOptions["tools"]>["discoveryLimits"];
  } = {},
) {
  return new McpClient({
    name: "fixture",
    versionNegotiation: { mode: "auto" },
    transport: {
      type: "streamableHttp",
      url,
      ssrfProtection: "disabled",
      headers: { authorization: "Bearer fixture-token" },
      terminateSessionOnClose: options.terminate,
    },
    tools: { discoveryLimits: options.limits },
  });
}

it.each(["abort", "close"])(
  "closes stalled negotiation before the response arrives: %s",
  async (action) => {
    let received!: () => void;
    const pending = new Promise<void>((resolve) => {
      received = resolve;
    });
    const url = await fixture(async (request) => {
      await body(request);
      received();
    });
    const mcp = client(url);
    const controller = new AbortController();
    const discovery = mcp.connect({ abortSignal: controller.signal });
    const rejected = expect(discovery).rejects.toThrow();
    await pending;
    if (action === "abort") controller.abort();
    else await mcp.close();
    // The server never releases the response. A connection still probing will time out this test.
    await rejected;
    await mcp.close();
  },
  1500,
);

it.each([
  "success",
  "tool error",
  "initialization error",
  "cancelled",
  "DELETE unsupported",
  "DELETE fails",
  "DELETE stalls",
  "persistent",
])(
  "cleans up legacy discovery sessions: %s",
  async (scenario) => {
    const deletions: {
      session: string | string[] | undefined;
      token: string | undefined;
      path: string | undefined;
    }[] = [];
    const controller = new AbortController();
    const url = await fixture(async (request, response) => {
      if (request.method === "DELETE") {
        deletions.push({
          session: request.headers["mcp-session-id"],
          token: request.headers.authorization,
          path: request.url,
        });
        if (scenario === "DELETE stalls") return;
        response
          .writeHead(
            scenario === "DELETE unsupported" ? 405 : scenario === "DELETE fails" ? 500 : 204,
          )
          .end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const message = await body(request);
      if (message.method === "notifications/initialized" && scenario === "initialization error") {
        response.writeHead(500).end("Initialization rejected");
        return;
      }
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (
        message.method === "server/discover" ||
        (message.method === "tools/list" && scenario === "tool error")
      ) {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Unavailable" },
          }),
        );
        return;
      }
      if (message.method === "tools/list" && scenario === "cancelled") {
        controller.abort();
        return;
      }
      json(
        response,
        message.id,
        message.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : { tools: [] },
        { "mcp-session-id": "temporary-session" },
      );
    });
    const mcp = client(url, scenario === "persistent" ? {} : { terminate: true });
    const started = performance.now();
    const discovery = mcp.connect({ abortSignal: controller.signal });
    if (scenario === "tool error") await expect(discovery).rejects.toThrow("Unavailable");
    else if (["initialization error", "cancelled"].includes(scenario))
      await expect(discovery).rejects.toThrow();
    else expect((await discovery).tools).toEqual([]);
    await Promise.all([mcp.close(), mcp.close()]);
    expect(deletions).toEqual(
      scenario === "persistent"
        ? []
        : [{ session: "temporary-session", token: "Bearer fixture-token", path: "/mcp" }],
    );
    expect(performance.now() - started).toBeLessThan(3000);
  },
  4000,
);

it.each(["within limits", "tool count", "catalog bytes"])(
  "bounds cumulative pages: %s",
  async (scenario) => {
    let pages = 0;
    const url = await fixture(async (request, response) => {
      const message = await body(request);
      if (message.method === "server/discover") {
        json(response, message.id, {
          supportedVersions: ["2026-07-28"],
          capabilities: { tools: {} },
        });
        return;
      }
      pages++;
      expect(message.params?.cursor).toBe(pages === 1 ? undefined : String(pages - 1));
      json(response, message.id, {
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "public",
        tools: Array.from({ length: scenario === "catalog bytes" ? 15 : 100 }, (_, index) => ({
          name: `tool_${pages}_${index}`,
          description: scenario === "catalog bytes" ? "文".repeat(4000) : "",
          inputSchema: { type: "object" },
        })),
        ...(pages < (scenario === "within limits" ? 2 : 5) ? { nextCursor: String(pages) } : {}),
      });
    });
    const mcp = client(url, { limits: { maxTools: 200, maxBytes: 256_000 } });
    const discovery = mcp.connect();
    if (scenario === "within limits") expect((await discovery).tools).toHaveLength(200);
    else
      await expect(discovery).rejects.toThrow(
        scenario === "tool count"
          ? "MCP tool count limit exceeded"
          : "MCP tool catalog byte limit exceeded",
      );
    expect(pages).toBe(scenario === "tool count" ? 3 : 2);
    await mcp.close();
  },
);

it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid discovery limits before transport creation: %s",
  async (invalid) => {
    for (const key of ["maxTools", "maxBytes"] as const) {
      let created = false;
      const mcp = new McpClient({
        name: "invalid",
        transport: {
          type: "custom",
          create: () => {
            created = true;
            throw new Error("Must not connect");
          },
        },
        tools: { discoveryLimits: { maxTools: 200, maxBytes: 256_000, [key]: invalid } },
      });
      await expect(mcp.connect()).rejects.toThrow("MCP discovery limits must be positive integers");
      expect(created).toBe(false);
    }
  },
);

it("closes a transport returned after close completed during asynchronous creation", async () => {
  let release!: (transport: {
    start(): Promise<void>;
    send(): Promise<void>;
    close(): Promise<void>;
  }) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const transport = {
    async start() {},
    async send() {},
    close: async () => {
      closed++;
    },
  };
  let closed = 0;
  const mcp = new McpClient({
    name: "late",
    transport: {
      type: "custom",
      create: () => {
        entered();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  const connecting = mcp.connect();
  const rejected = expect(connecting).rejects.toMatchObject({ name: "AbortError" });
  await started;
  await mcp.close();
  release(transport);
  await rejected;
  expect(closed).toBe(1);
});

it("resets discovery budgets when retrying a failed connection", async () => {
  let attempts = 0;
  const url = await fixture(async (request, response) => {
    const message = await body(request);
    if (message.method === "server/discover") {
      attempts++;
      json(response, message.id, {
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {} },
      });
      return;
    }
    json(response, message.id, {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "public",
      tools: Array.from({ length: attempts === 1 ? 3 : 2 }, (_, index) => ({
        name: `tool_${index}`,
        inputSchema: { type: "object" },
      })),
    });
  });
  const mcp = client(url, { limits: { maxTools: 2, maxBytes: 256_000 } });
  await expect(mcp.connect()).rejects.toThrow("MCP tool count limit exceeded");
  expect((await mcp.connect()).tools).toHaveLength(2);
  await mcp.close();
});

it.each([4, 3])("counts array syntax for every empty tool page (maxBytes=%s)", async (maxBytes) => {
  let pages = 0;
  const url = await fixture(async (request, response) => {
    const message = await body(request);
    if (message.method === "server/discover") {
      json(response, message.id, {
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {} },
      });
      return;
    }
    pages++;
    json(response, message.id, {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "public",
      tools: [],
      ...(pages === 1 ? { nextCursor: "2" } : {}),
    });
  });
  const mcp = client(url, { limits: { maxTools: 200, maxBytes } });
  if (maxBytes === 4) expect((await mcp.connect()).tools).toEqual([]);
  else await expect(mcp.connect()).rejects.toThrow("MCP tool catalog byte limit exceeded");
  expect(pages).toBe(2);
  await mcp.close();
});

it("preserves SDK header refresh and output validation after initial discovery reaches its limit", async () => {
  let pages = 0;
  let calls = 0;
  let deletions = 0;
  const headers: (string | string[] | undefined)[] = [];
  const url = await fixture(async (request, response) => {
    if (request.method === "DELETE") {
      deletions++;
      response.writeHead(204).end();
      return;
    }
    const message = await body(request);
    if (message.method === "server/discover") {
      json(response, message.id, {
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {} },
      });
      return;
    }
    if (message.method === "tools/list") {
      pages++;
      json(response, message.id, {
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "public",
        tools: [
          {
            name: "lookup",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", "x-mcp-header": pages === 1 ? "old" : "query" },
              },
            },
            outputSchema: {
              type: "object",
              properties: { count: { type: "number" } },
              required: ["count"],
            },
          },
        ],
      });
      return;
    }
    calls++;
    headers.push(request.headers["mcp-param-query"]);
    if (calls === 1) {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32020, message: "Header mismatch" },
        }),
      );
      return;
    }
    json(response, message.id, {
      resultType: "complete",
      content: [],
      structuredContent: { count: "invalid" },
    });
  });
  const mcp = client(url, { terminate: true, limits: { maxTools: 1, maxBytes: 256_000 } });
  const registration = await mcp.connect();
  await expect(registration.tools[0]!.call({ query: "docs" })).rejects.toThrow(/output schema/);
  expect(pages).toBe(2);
  expect(calls).toBe(2);
  expect(headers).toEqual([undefined, "docs"]);
  await mcp.close();
  expect(deletions).toBe(0);
});

it("bounds session cleanup even when authentication never settles", async () => {
  let tokenReads = 0;
  const url = await fixture(async (_request, response) => {
    response.writeHead(405).end();
  });
  const mcp = new McpClient({
    name: "auth-stall",
    transport: {
      type: "streamableHttp",
      url,
      ssrfProtection: "disabled",
      sessionId: "existing-session",
      terminateSessionOnClose: true,
      authProvider: {
        redirectUrl: undefined,
        clientMetadata: { redirect_uris: [] },
        clientInformation: () => undefined,
        tokens: () => {
          tokenReads++;
          return new Promise(() => {});
        },
        saveTokens() {},
        redirectToAuthorization() {},
        saveCodeVerifier() {},
        codeVerifier: () => "unused",
      },
    },
  });
  await mcp.connect();
  const started = performance.now();
  await mcp.close();
  expect(tokenReads).toBeGreaterThan(0);
  expect(performance.now() - started).toBeLessThan(3000);
}, 4000);
