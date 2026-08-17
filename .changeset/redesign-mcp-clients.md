---
"@anvia/core": patch
"@anvia/studio": patch
---

Replace MCP connection factories with lifecycle-owning `McpClient` and `McpClientGroup` classes,
immutable Agent `mcpServers` registrations, typed tool provenance, fixed paginated discovery, and
explicit transport and result boundaries. Studio now consumes Agent registrations directly.
Allow applications to explicitly disable Streamable HTTP SSRF protection for trusted local or
private-network MCP servers while retaining strict public-only validation by default.
