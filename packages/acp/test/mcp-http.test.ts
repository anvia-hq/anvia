import { Agent } from "@anvia/core/agent";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { makeAgent, wireFixture } from "./helpers.js";
import type { AcpMcpOptions, AcpSessionContext } from "../src/types.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function httpServer(mode: "modern" | "legacy" | "redirect" = "legacy") {
  const calls: Array<{
    method: string;
    path: string;
    token: string | undefined;
    session: string | undefined;
  }> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = body ? JSON.parse(body) : {};
    calls.push({
      method: message.method ?? request.method,
      path: request.url!,
      token: request.headers.authorization,
      session: request.headers["mcp-session-id"] as string | undefined,
    });
    if (mode === "redirect") {
      response.writeHead(307, { location: "/stolen" }).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(request.method === "DELETE" ? 204 : 405).end();
      return;
    }
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    let result: Record<string, unknown>;
    if (message.method === "server/discover") {
      result = { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } };
    } else if (message.method === "initialize") {
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "editor", version: "1" },
      };
    } else {
      result =
        message.method === "tools/call"
          ? { content: [{ type: "text", text: "http result" }] }
          : { tools: [{ name: "echo", inputSchema: { type: "object" } }] };
      if (mode === "modern") {
        result.resultType = "complete";
        if (message.method === "tools/list") {
          result.ttlMs = 0;
          result.cacheScope = "public";
        }
      }
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (mode === "legacy") headers["mcp-session-id"] = "fixture-session";
    const reply: Record<string, unknown> = { jsonrpc: "2.0", id: message.id };
    if (mode !== "modern" && message.method === "server/discover") {
      reply.error = { code: -32601, message: "Not supported" };
    } else {
      reply.result = result;
    }
    response.writeHead(200, headers).end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  return { url, calls };
}
async function peer(mcp: AcpMcpOptions = {}) {
  const contexts: AcpSessionContext[] = [];
  const fixture = wireFixture({
    mcp,
    sessionFactory(context) {
      contexts.push(context);
      return {
        agent: new Agent({ id: "http", model: makeAgent().model, mcpServers: context.mcpServers }),
      };
    },
  });
  cleanup.push(() => fixture.connection.close());
  const initialized = await fixture.request("initialize", { protocolVersion: 1 });
  return { ...fixture, contexts, initialized };
}
function declaration(url: string) {
  return {
    type: "http",
    name: "editor",
    url,
    headers: [{ name: "Authorization", value: "Bearer fixture-only" }],
  };
}

it.each(["modern", "legacy"] as const)(
  "connects trusted HTTP with %s negotiation, tools, headers and cleanup",
  async (mode) => {
    const server = await httpServer(mode);
    // A hostname with no DNS record still connects only to the explicitly approved address.
    const url = server.url.replace("127.0.0.1", "editor.invalid");
    const fixture = await peer({
      http: true,
      trustedHttpEndpoints: [{ url, addresses: ["127.0.0.1"] }],
    });
    expect(fixture.initialized.result?.agentCapabilities).toMatchObject({
      mcpCapabilities: { http: true, sse: false },
    });
    const created = await fixture.request("session/new", {
      cwd: process.cwd(),
      mcpServers: [declaration(url)],
    });
    expect(created.error).toBeUndefined();
    const tool = fixture.contexts[0]!.mcpServers[0]!.tools[0]!;
    expect(tool.requiresApproval).toBe(true);
    await tool.call({});
    expect(server.calls.some((call) => call.method === "tools/call")).toBe(true);
    expect(server.calls.some((call) => call.method === "initialize")).toBe(mode === "legacy");
    await fixture.connection.close();
    expect(
      server.calls.every((call) => call.token === "Bearer fixture-only" && call.path === "/mcp"),
    ).toBe(true);
    if (mode === "legacy")
      expect(server.calls.filter((call) => call.method === "DELETE")).toEqual([
        {
          method: "DELETE",
          path: "/mcp",
          token: "Bearer fixture-only",
          session: "fixture-session",
        },
      ]);
  },
);

it("keeps HTTP opt-in, rejects untrusted private URLs, and scopes trust to the exact endpoint", async () => {
  const server = await httpServer();
  const disabled = await peer();
  expect(disabled.initialized.result?.agentCapabilities).toMatchObject({
    mcpCapabilities: { http: false, sse: false },
  });
  expect(
    (
      await disabled.request("session/new", {
        cwd: process.cwd(),
        mcpServers: [declaration(server.url)],
      })
    ).error?.data?.kind,
  ).toBe("unsupported_mcp");
  const strict = await peer({ http: true });
  expect(
    (
      await strict.request("session/new", {
        cwd: process.cwd(),
        mcpServers: [declaration(server.url)],
      })
    ).error?.data?.kind,
  ).toBe("configuration_error");
  const trusted = await peer({
    http: true,
    trustedHttpEndpoints: [{ url: server.url, addresses: ["127.0.0.1"] }],
  });
  expect(
    (
      await trusted.request("session/new", {
        cwd: process.cwd(),
        mcpServers: [declaration(`${server.url}/other`)],
      })
    ).error?.data?.kind,
  ).toBe("configuration_error");
  expect(server.calls).toEqual([]);
});

it("does not follow endpoint redirects or expose headers in ACP errors", async () => {
  const server = await httpServer("redirect");
  const fixture = await peer({
    http: true,
    trustedHttpEndpoints: [{ url: server.url, addresses: ["127.0.0.1"] }],
  });
  const reply = await fixture.request("session/new", {
    cwd: process.cwd(),
    mcpServers: [declaration(server.url)],
  });
  expect(reply.error?.data?.kind).toBe("configuration_error");
  expect(JSON.stringify(reply)).not.toContain("fixture-only");
  expect(server.calls.length).toBeGreaterThan(0);
  expect(server.calls.every((call) => call.path === "/mcp")).toBe(true);
});
