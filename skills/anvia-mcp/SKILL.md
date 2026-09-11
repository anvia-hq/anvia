---
name: anvia-mcp
description: Connect MCP servers to Anvia agents — clients, transports, tool discovery, URL safety, and lifecycle.
---

# Anvia MCP Skill

Use this skill when the user wants tools from an MCP server: configuring an
`McpClient`, choosing stdio vs Streamable HTTP, handling version negotiation
and URL safety, grouping servers, or wiring them into an `Agent`.

## Process

1. Configure clients (`references/clients.md`) — one `McpClient` per server.
2. Apply the safety rules (`references/safety.md`) — especially for HTTP servers.
3. Run `scripts/check-mcp.sh` from the app root before claiming done.

## Minimal slice

```ts
import { Agent } from "@anvia/core/agent";
import { McpClient } from "@anvia/mcp";

const counterMcp = new McpClient({
  name: "counter",
  transport: { type: "stdio", command: "tsx", args: ["./mcp-counter-server.ts"] },
});
const counterServer = await counterMcp.connect();

try {
  const agent = new Agent({
    id: "agent",
    model: agentModel,
    instructions: "Use MCP tools for arithmetic and counter updates.",
    mcpServers: [counterServer], // the only path for MCP tools — never via skills
    maxTurns: 3,
  });
  for await (const event of agent.stream({ prompt: "Add 8 and 13." })) {
    if (event.type === "response") console.log("final:", event.text);
  }
} finally {
  await counterMcp.close();
}
```

## Output

Prefer stdio for local servers, Streamable HTTP for remote ones. Point to the
relevant reference file instead of pasting its contents into chat.
