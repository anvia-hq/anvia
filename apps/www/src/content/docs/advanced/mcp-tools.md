---
title: MCP tools
description: Connect external MCP servers and adapt MCP tools for agents.
section: advanced
sidebar:
  group: Tools and action safety
  order: 26
---

MCP connects external tool servers to Anvia agents. Use it when tools are provided by an MCP server rather than local application code.

Core can connect to stdio, HTTP, or SSE MCP servers, list their tools, adapt them to Anvia `Tool` objects, and register them on an agent.

## Connect A Server

```ts
import { AgentBuilder } from "@anvia/core";
import { connectMcp, mcp } from "@anvia/core/mcp";

const filesystem = await connectMcp(
  mcp.stdio({
    name: "filesystem",
    command: "npx",
    args: ["@modelcontextprotocol/server-filesystem", "/workspace/docs"],
  }),
);
```

The returned server has a name, a list of adapted tools, and a `close()` method.

```ts
try {
  const agent = new AgentBuilder("docs-operator", model)
    .instructions("Use filesystem tools only for documentation files.")
    .mcp([filesystem])
    .build();

  const response = await agent.prompt("List the docs files.").send();
} finally {
  await filesystem.close();
}
```

Keep server lifecycle explicit. Long-running apps can connect during startup and close during shutdown. Short-lived jobs can connect inside the job and close in `finally`.

The lower-level MCP contracts are also exported for adapters and tests:

- `McpConnection` describes something that can connect and return a client
- `McpClient` exposes `listTools()`, `callTool(...)`, and `close()`
- `McpServer` is the connected Anvia-facing server with adapted tools
- `McpStdioOptions`, `McpHttpOptions`, and `McpSseOptions` type the built-in connection helpers

## HTTP And SSE

Use HTTP or SSE when the server is remote:

```ts
const crm = await connectMcp(
  mcp.http({
    name: "crm",
    url: "https://internal.example.com/mcp",
  }),
);
```

```ts
const events = await connectMcp(
  mcp.sse({
    name: "events",
    url: "https://internal.example.com/mcp/sse",
  }),
);
```

Remote MCP servers are privileged dependencies. Keep credentials, network access, and tenant routing on the server side.

## Result Mapping

MCP text results become text tool results. MCP image results become data URLs. MCP resources are serialized with their URI and content. MCP `isError` results throw an error with the returned text when available.

If a server returns `{ toolResult }`, core serializes that value to a string unless it is already a string.

MCP tool arguments must be JSON objects. If a model or wrapper passes `null`, `undefined`, or a non-object argument payload, core maps it before calling the MCP client or throws before the remote server is invoked.

## Trust Boundaries

Treat MCP tools like any other tool:

- the agent can request them when their definitions are exposed
- the MCP server owns its own permission checks
- your runner still owns user and tenant authorization
- browser code should not connect directly to privileged MCP servers
- tool results should be filtered before reaching users

If an MCP server exposes broad file, shell, database, or network access, wrap it in application policy or run it in a constrained environment.

## MCP With Local Tools

MCP tools can be combined with local tools:

```ts
const agent = new AgentBuilder("ops", model)
  .tools([createIncidentTool(scope)])
  .mcp([filesystem, crm])
  .build();
```

Use local tools for product-specific permissions and side effects. Use MCP tools for external capabilities that are already provided by an MCP server.

## Observability

MCP-adapted tools carry server metadata internally. Observers can see the MCP server name in tool metadata. This helps distinguish local tools from tools imported from external MCP servers.

## MCP Checklist

Before shipping MCP tools, check:

- server credentials stay server-side
- server lifecycle is closed on shutdown or job completion
- exposed tools are appropriate for the agent role
- MCP results are safe for model context
- product permissions are enforced outside prompt text
- remote MCP failures are mapped to safe user-facing errors
