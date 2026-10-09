# @anvia/mcp

Connect Anvia agents to Model Context Protocol servers. Discover remote tools once, register them
with an Agent, and keep connection lifecycle and credentials under your application's control.

## Install

```sh
pnpm add @anvia/mcp @anvia/core @anvia/openai
```

Requires Node.js 20 or newer, or Bun 1.3.14. The quickstart uses OpenAI as the agent's model provider.

## Quickstart

Set `OPENAI_API_KEY`, replace the MCP endpoint with your server URL, and connect its tools:

```ts
import { Agent } from "@anvia/core/agent";
import { McpClient, McpClientGroup } from "@anvia/mcp";
import { OpenAIClient } from "@anvia/openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY.");
const model = new OpenAIClient({ apiKey }).completionModel({
  modelId: "gpt-5",
  api: "responses",
});
const client = new McpClient({
  name: "knowledge",
  versionNegotiation: { mode: "auto" },
  transport: { type: "streamableHttp", url: "https://mcp.example.com/mcp" },
});
const mcp = await McpClientGroup.connect({ clients: [client] });

try {
  const agent = new Agent({ id: "assistant", model, mcpServers: mcp.servers });
  const result = await agent.generate({ prompt: "Find the onboarding guide." });
  if (result.type === "response") console.log(result.output);
} finally {
  await mcp.close();
}
```

Connections discover tools and return immutable registration snapshots. Reconnect and rebuild the
Agent to pick up changed remote tool definitions. Agents do not close caller-owned connections.

## Capabilities

- Stdio and Streamable HTTP transports through the official MCP client SDK.
- Protocol negotiation, paginated tool discovery, and tool prefixes.
- Group connection management with cleanup when initialization fails.
- HTTP URL safety, bounded response buffering, and explicit authentication configuration.
- Opt-in cumulative `tools.discoveryLimits` and bounded temporary-session cleanup with
  `transport.terminateSessionOnClose`; see the connection guide for exact semantics.

The example uses automatic protocol negotiation for compatibility with older servers. HTTP URL
safety is enabled by default; consult the guide when intentionally connecting to a trusted local
or private-network server.

## Learn more

- [MCP connection guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/mcp.md)
- [Core agents](https://github.com/anvia-hq/anvia/tree/main/packages/core#readme)
- [MCP Agent Skill](https://github.com/anvia-hq/anvia/tree/main/skills/anvia-mcp)
