import { describe, expect, expectTypeOf, it } from "vitest";
import * as mcp from "../src";

describe("public exports", () => {
  it("exposes MCP clients and Agent registration contracts", () => {
    expect(mcp.McpClient).toBeTypeOf("function");
    expect(mcp.McpClientGroup).toBeTypeOf("function");
    expect(mcp.isMcpTool).toBeTypeOf("function");
    expectTypeOf<mcp.McpClientOptions>().not.toBeNever();
    expectTypeOf<mcp.McpServer>().not.toBeNever();
    expectTypeOf<mcp.McpTool>().not.toBeNever();

    if (Date.now() === Number.NEGATIVE_INFINITY) {
      new mcp.McpClient({
        name: "http",
        transport: {
          type: "streamableHttp",
          url: "https://example.com/mcp",
          // @ts-expect-error Built-in HTTP intentionally forbids custom fetch.
          fetch: globalThis.fetch,
        },
      });
      new mcp.McpClient({
        name: "local-http",
        transport: {
          type: "streamableHttp",
          url: "http://localhost:3000/mcp",
          ssrfProtection: "disabled",
        },
      });
      new mcp.McpClient({
        name: "legacy-request-init",
        transport: {
          type: "streamableHttp",
          url: "https://example.com/mcp",
          // @ts-expect-error Built-in HTTP exposes explicit headers, not arbitrary Fetch options.
          requestInit: {},
        },
      });
      new mcp.McpClient({
        name: "invalid-policy",
        transport: {
          type: "streamableHttp",
          url: "https://example.com/mcp",
          // @ts-expect-error SSRF protection accepts only the explicit public-safe or opt-out mode.
          ssrfProtection: "unknown",
        },
      });
      const server = null as unknown as mcp.McpServer;
      // @ts-expect-error McpServer is a registration snapshot and does not own lifecycle.
      server.close();
    }
  });
});
