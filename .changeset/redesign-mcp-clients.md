---
"@anvia/core": patch
"@anvia/studio": patch
---

Replace MCP connection factories with lifecycle-owning `McpClient` and `McpClientGroup` classes,
immutable Agent `mcpServers` registrations, typed tool provenance, fixed paginated discovery, and
explicit transport and result boundaries. Studio now consumes Agent registrations directly.
