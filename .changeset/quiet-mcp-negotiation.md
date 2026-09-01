---
"@anvia/mcp": patch
---

Allow MCP clients to configure protocol version negotiation so they can connect to 2025-era servers
using automatic fallback or the legacy initialization handshake. Preserve the strict `2026-07-28`
pin as the default.
