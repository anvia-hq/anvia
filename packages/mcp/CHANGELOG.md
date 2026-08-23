# @anvia/mcp

## 1.0.0-rc.11

### Patch Changes

- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/core@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- ef7ad39: Move MCP clients, transports, tool discovery, result mapping, and URL safety into the dedicated
  `@anvia/mcp` package. Core keeps only the lightweight MCP registration contracts consumed by Agent;
  applications now import `McpClient` and `McpClientGroup` from `@anvia/mcp`.
- 46bedb8: Migrate the MCP client integration to the split Model Context Protocol TypeScript SDK v2 packages
  and require the modern MCP `2026-07-28` protocol without legacy fallback.
- Updated dependencies [ef7ad39]
- Updated dependencies [9b9fe04]
  - @anvia/core@1.0.0-rc.10
