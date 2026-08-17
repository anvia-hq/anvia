---
"@anvia/core": patch
"@anvia/studio": patch
---

Replace MCP connection factories with lifecycle-owning `McpClient` and `McpClientGroup` classes,
immutable Agent `mcpServers` registrations, typed tool provenance, fixed paginated discovery, and
explicit transport and result boundaries. Studio now consumes Agent registrations directly.
Allow applications to explicitly disable Streamable HTTP SSRF protection for trusted local or
private-network MCP servers while retaining strict public-only validation by default.
Replace the arbitrary Streamable HTTP `requestInit` escape hatch with explicit, strictly validated
string `headers` scoped to the exact MCP endpoint while keeping protocol-owned request fields and
OAuth traffic isolated.
