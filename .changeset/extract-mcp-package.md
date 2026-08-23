---
"@anvia/core": patch
"@anvia/mcp": patch
---

Move MCP clients, transports, tool discovery, result mapping, and URL safety into the dedicated
`@anvia/mcp` package. Core keeps only the lightweight MCP registration contracts consumed by Agent;
applications now import `McpClient` and `McpClientGroup` from `@anvia/mcp`.
