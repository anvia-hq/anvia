# @anvia/mcp

Model Context Protocol client integration for Anvia agents.

This package owns MCP connections, transports, tool discovery, and cleanup. `@anvia/core` keeps only
the lightweight MCP registration contracts consumed by `Agent`.

Requires Node.js 20 or newer, or Bun 1.3.14, and uses the official MCP TypeScript SDK v2 client.

## Installation

```sh
pnpm add @anvia/mcp @anvia/core
```

### Bun

Bun 1.3.14 is the currently tested and supported runtime baseline:

```sh
bun add @anvia/mcp @anvia/core
```

Compatibility tests cover modern protocol negotiation, Streamable HTTP with chunked SSE responses,
stdio subprocesses, URL-safety enforcement, and installation from packed package artifacts.

## Usage

```ts
import { Agent } from "@anvia/core/agent";
import { McpClient, McpClientGroup } from "@anvia/mcp";

const filesystem = new McpClient({
  name: "filesystem",
  transport: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
  },
});
const github = new McpClient({
  name: "github",
  transport: {
    type: "streamableHttp",
    url: "https://mcp.example.com/mcp",
    headers: { authorization: `Bearer ${process.env.MCP_TOKEN}` },
  },
  tools: { prefix: "github_" },
});

const mcp = await McpClientGroup.connect({ clients: [filesystem, github] });
const agent = new Agent({ id: "assistant", model, mcpServers: mcp.servers });

try {
  await agent.generate({ prompt: "Find the issue and update it." });
} finally {
  await mcp.close();
}
```

Construction performs no I/O. `connect()` discovers every tool page once and returns a frozen
registration snapshot. Reconnect and rebuild the Agent to adopt changed remote tools.

`@anvia/mcp` requires the modern MCP `2026-07-28` protocol. Connections fail clearly when a server
does not support that revision; the package never attempts or falls back to the legacy MCP
handshake.

Built-in Streamable HTTP connections enforce Anvia URL safety by default and do not accept a custom
`fetch`. Static request headers are explicit transport configuration; arbitrary Fetch `RequestInit`
fields are not exposed because the MCP transport owns its HTTP method, body, abort signal, session,
and protocol headers. Configured headers are sent only to the exact MCP endpoint, are not attached to
OAuth requests, and cause endpoint redirects to fail instead of forwarding credentials. A static
`authorization` header cannot be combined with `authProvider`.

For an intentionally local or private-network server, set `ssrfProtection: "disabled"` on that
transport. This disables hostname and DNS restrictions for the complete transport, including
redirects and OAuth discovery, while still requiring HTTP(S). Use it only when the application owns
and trusts that network boundary. MCP server instructions remain inspectable metadata and are not
added to Agent instructions.

## Exports

- `McpClient`
- `McpClientGroup`
- `McpClientOptions`
- `McpClientTransport`
- `McpServer`
- `McpTool`
- `isMcpTool`

## Development

```sh
pnpm --filter @anvia/mcp typecheck
pnpm --filter @anvia/mcp test
pnpm --filter @anvia/mcp build
```
