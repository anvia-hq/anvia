# MCP Clients

`@anvia/mcp` owns connections, transports, tool discovery, and cleanup (official
MCP TypeScript SDK v2 client under the hood). `@anvia/core` keeps only the
registration contracts the `Agent` consumes. Construction performs no I/O.

## Transports

```ts
import { McpClient, McpClientGroup } from "@anvia/mcp";

// Local subprocess.
const filesystem = new McpClient({
  name: "filesystem",
  versionNegotiation: { mode: "auto" },
  transport: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
  },
});

// Remote server.
const github = new McpClient({
  name: "github",
  transport: {
    type: "streamableHttp",
    url: "https://mcp.example.com/mcp",
    headers: { authorization: `Bearer ${process.env.MCP_TOKEN}` },
  },
  tools: { prefix: "github_" },
});
```

- Every client needs a unique `name` — it identifies the server in logs,
  errors, and the Studio MCP inspector.
- `tools.prefix` namespaces remote tools (`github_...`) so two servers never
  collide. Set it whenever more than one server is connected.
- Read tokens from the environment at the boundary; never commit them.
- Remote servers that need real OAuth take `authProvider` (an
  `OAuthClientProvider`) instead of — not alongside — a `headers.authorization`
  value; the client rejects the combination. `reconnectionOptions` tunes
  reconnect behavior and `sessionId` resumes a known streamable-HTTP session.
- Adapters not covered above: pass `transport: { type: "custom", ... }` with
  your own MCP `Transport` implementation; URL safety and discovery behavior
  are unchanged.

## Connect and wire

```ts
const mcp = await McpClientGroup.connect({ clients: [filesystem, github] });
const agent = new Agent({ id: "assistant", model, mcpServers: mcp.servers });

try {
  await agent.generate({ prompt: "Find the issue and update it." });
} finally {
  await mcp.close();
}
```

- `connect()` discovers every tool page once and returns a frozen registration
  snapshot. A single client also exposes `connect()` returning one server.
- The Agent only sees `mcpServers`. MCP tools must never be passed via
  `Agent.skills` — the Agent rejects them there.
- Always `close()` clients (try/finally). To adopt changed remote tools,
  reconnect and rebuild the Agent — snapshots do not refresh in place.

## Version negotiation

By default `@anvia/mcp` requires the modern MCP `2026-07-28` protocol and fails
clearly otherwise. For older servers set `versionNegotiation: { mode: "auto" }`
(probe modern, fall back to the legacy handshake) or `{ mode: "legacy" }` for a
known 2025-era server. Prefer `auto` over `legacy` unless the server is pinned.
